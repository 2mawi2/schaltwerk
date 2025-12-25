import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { theme } from '../../common/theme'
import { typography } from '../../common/typography'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import type {
  AcpPermissionRequestPayload,
  AcpRequestId,
  AcpSessionStatusPayload,
  AcpSessionUpdatePayload,
  AcpTerminalOutputPayload,
} from '../../common/events'

type ChatItem =
  | { kind: 'status'; id: string; status: string; message?: string | null }
  | { kind: 'message'; id: string; role: 'user' | 'assistant' | 'thought'; text: string }
  | { kind: 'tool_call'; id: string; toolCallId: string }
  | { kind: 'plan'; id: string; plan: unknown }

type ToolCallState = Record<string, unknown>

type TerminalOutputState = {
  output: string
  truncated: boolean
  exitStatus?: unknown
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const v = value[key]
  return typeof v === 'string' ? v : null
}

function getArray(value: unknown, key: string): unknown[] | null {
  if (!isRecord(value)) return null
  const v = value[key]
  return Array.isArray(v) ? v : null
}

let nextStableId = 0
function stableId(prefix: string): string {
  nextStableId += 1
  return `${prefix}-${nextStableId}`
}

const markdownComponents: Partial<Components> = {
  a: ({ href, children }) => (
    <a
      href={href}
      style={{
        color: theme.colors.accent.blue.DEFAULT,
        textDecoration: 'underline',
        cursor: 'pointer',
      }}
    >
      {children}
    </a>
  ),
  code: ({ children }) => (
    <code
      style={{
        backgroundColor: theme.colors.background.elevated,
        color: theme.colors.text.primary,
        padding: '2px 4px',
        borderRadius: 4,
        fontFamily: theme.fontFamily.mono,
        fontSize: theme.fontSize.code,
      }}
    >
      {children}
    </code>
  ),
  pre: ({ children }) => (
    <pre
      style={{
        backgroundColor: theme.colors.background.elevated,
        color: theme.colors.text.primary,
        padding: 12,
        borderRadius: 6,
        overflowX: 'auto',
        fontFamily: theme.fontFamily.mono,
        fontSize: theme.fontSize.code,
        lineHeight: theme.lineHeight.body,
      }}
    >
      {children}
    </pre>
  ),
}

function ToolCallView({
  toolCall,
  terminalOutputs,
}: {
  toolCall: ToolCallState
  terminalOutputs: Record<string, TerminalOutputState>
}) {
  const title = getString(toolCall, 'title') ?? 'Tool call'
  const kind = getString(toolCall, 'kind')
  const status = getString(toolCall, 'status')
  const toolCallId = getString(toolCall, 'toolCallId')
  const content = getArray(toolCall, 'content') ?? []

  const headerLabel = [kind, status].filter(Boolean).join(' · ')

  return (
    <div
      style={{
        border: `1px solid ${theme.colors.border.subtle}`,
        borderRadius: 8,
        padding: 12,
        backgroundColor: theme.colors.background.tertiary,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 8 }}>
        <div style={{ ...typography.label, color: theme.colors.text.primary }}>{title}</div>
        {headerLabel && (
          <div style={{ ...typography.caption, color: theme.colors.text.tertiary }}>{headerLabel}</div>
        )}
        {toolCallId && (
          <div style={{ ...typography.caption, color: theme.colors.text.muted, marginLeft: 'auto' }}>
            {toolCallId}
          </div>
        )}
      </div>

      {content.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {content.map((entry, idx) => {
            if (!isRecord(entry) || typeof entry.type !== 'string') {
              return (
                <pre
                  key={idx}
                  style={{
                    margin: 0,
                    backgroundColor: theme.colors.background.elevated,
                    borderRadius: 6,
                    padding: 10,
                    overflowX: 'auto',
                    ...typography.code,
                    color: theme.colors.text.primary,
                  }}
                >
                  {JSON.stringify(entry, null, 2)}
                </pre>
              )
            }

            if (entry.type === 'diff') {
              const path = getString(entry, 'path') ?? 'unknown'
              const oldText = typeof entry.oldText === 'string' ? entry.oldText : entry.oldText === null ? null : null
              const newText = typeof entry.newText === 'string' ? entry.newText : ''
              return (
                <div
                  key={idx}
                  style={{
                    border: `1px solid ${theme.colors.border.default}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      backgroundColor: theme.colors.background.elevated,
                      color: theme.colors.text.secondary,
                      ...typography.caption,
                      borderBottom: `1px solid ${theme.colors.border.default}`,
                    }}
                  >
                    Diff: {path}
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr' }}>
                    <div style={{ padding: 10, borderRight: `1px solid ${theme.colors.border.default}` }}>
                      <div style={{ ...typography.caption, color: theme.colors.text.tertiary, marginBottom: 6 }}>
                        Before
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre',
                          overflowX: 'auto',
                          ...typography.code,
                          color: theme.colors.text.primary,
                        }}
                      >
                        {oldText ?? ''}
                      </pre>
                    </div>
                    <div style={{ padding: 10 }}>
                      <div style={{ ...typography.caption, color: theme.colors.text.tertiary, marginBottom: 6 }}>
                        After
                      </div>
                      <pre
                        style={{
                          margin: 0,
                          whiteSpace: 'pre',
                          overflowX: 'auto',
                          ...typography.code,
                          color: theme.colors.text.primary,
                        }}
                      >
                        {newText}
                      </pre>
                    </div>
                  </div>
                </div>
              )
            }

            if (entry.type === 'terminal') {
              const terminalId = getString(entry, 'terminalId')
              const output = terminalId ? terminalOutputs[terminalId] : null
              return (
                <div
                  key={idx}
                  style={{
                    border: `1px solid ${theme.colors.border.default}`,
                    borderRadius: 6,
                    overflow: 'hidden',
                    backgroundColor: theme.colors.background.elevated,
                  }}
                >
                  <div
                    style={{
                      padding: '8px 10px',
                      color: theme.colors.text.secondary,
                      ...typography.caption,
                      borderBottom: `1px solid ${theme.colors.border.default}`,
                    }}
                  >
                    Terminal {terminalId ?? 'unknown'}
                  </div>
                  <pre
                    style={{
                      margin: 0,
                      padding: 10,
                      whiteSpace: 'pre-wrap',
                      overflowX: 'auto',
                      ...typography.code,
                      color: theme.colors.text.primary,
                    }}
                  >
                    {output?.output ?? ''}
                  </pre>
                </div>
              )
            }

            if (entry.type === 'content') {
              const block = isRecord(entry.content) ? entry.content : null
              const blockType = block ? getString(block, 'type') : null
              if (blockType === 'text') {
                const text = getString(block, 'text') ?? ''
                return (
                  <div key={idx} style={{ color: theme.colors.text.primary, ...typography.body }}>
                    <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                      {text}
                    </ReactMarkdown>
                  </div>
                )
              }
              return (
                <pre
                  key={idx}
                  style={{
                    margin: 0,
                    backgroundColor: theme.colors.background.elevated,
                    borderRadius: 6,
                    padding: 10,
                    overflowX: 'auto',
                    ...typography.code,
                    color: theme.colors.text.primary,
                  }}
                >
                  {JSON.stringify(entry, null, 2)}
                </pre>
              )
            }

            return (
              <pre
                key={idx}
                style={{
                  margin: 0,
                  backgroundColor: theme.colors.background.elevated,
                  borderRadius: 6,
                  padding: 10,
                  overflowX: 'auto',
                  ...typography.code,
                  color: theme.colors.text.primary,
                }}
              >
                {JSON.stringify(entry, null, 2)}
              </pre>
            )
          })}
        </div>
      )}
    </div>
  )
}

function PermissionPrompt({
  request,
  onSelect,
  onDismiss,
}: {
  request: AcpPermissionRequestPayload
  onSelect: (optionId: string) => void
  onDismiss: () => void
}) {
  const options = request.options
    .map((raw) => {
      if (!isRecord(raw)) return null
      const optionId = getString(raw, 'optionId')
      const name = getString(raw, 'name') ?? 'Option'
      const kind = getString(raw, 'kind')
      if (!optionId) return null
      return { optionId, name, kind }
    })
    .filter(Boolean) as Array<{ optionId: string; name: string; kind: string | null }>

  return (
    <div
      className="fixed inset-0 flex items-center justify-center z-50"
      style={{ backgroundColor: theme.colors.overlay.backdrop }}
      role="dialog"
      aria-modal="true"
    >
      <div
        style={{
          width: 520,
          maxWidth: '90vw',
          borderRadius: 10,
          backgroundColor: theme.colors.background.secondary,
          border: `1px solid ${theme.colors.border.default}`,
          padding: 16,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <div style={{ ...typography.heading, color: theme.colors.text.primary }}>
            Permission required
          </div>
          <button
            onClick={onDismiss}
            style={{
              marginLeft: 'auto',
              backgroundColor: 'transparent',
              border: `1px solid ${theme.colors.border.subtle}`,
              borderRadius: 8,
              padding: '6px 10px',
              color: theme.colors.text.secondary,
              ...typography.button,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <pre
          style={{
            margin: 0,
            backgroundColor: theme.colors.background.elevated,
            borderRadius: 8,
            padding: 12,
            overflowX: 'auto',
            maxHeight: 180,
            ...typography.code,
            color: theme.colors.text.primary,
          }}
        >
          {JSON.stringify(request.toolCall, null, 2)}
        </pre>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 14 }}>
          {options.map((opt) => (
            <button
              key={opt.optionId}
              onClick={() => onSelect(opt.optionId)}
              style={{
                textAlign: 'left',
                backgroundColor: theme.colors.background.tertiary,
                border: `1px solid ${theme.colors.border.subtle}`,
                borderRadius: 10,
                padding: '10px 12px',
                cursor: 'pointer',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 10 }}>
                <div style={{ ...typography.bodyLarge, color: theme.colors.text.primary }}>
                  {opt.name}
                </div>
                {opt.kind && (
                  <div style={{ ...typography.caption, color: theme.colors.text.tertiary }}>
                    {opt.kind}
                  </div>
                )}
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function AcpChatPanel({ sessionName }: { sessionName: string }) {
  const [status, setStatus] = useState<AcpSessionStatusPayload | null>(null)
  const [items, setItems] = useState<ChatItem[]>([])
  const [toolCalls, setToolCalls] = useState<Record<string, ToolCallState>>({})
  const [terminalOutputs, setTerminalOutputs] = useState<Record<string, TerminalOutputState>>({})
  const [pendingPermission, setPendingPermission] = useState<AcpPermissionRequestPayload | null>(null)
  const [input, setInput] = useState('')
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const canSend = useMemo(() => status?.status === 'ready' && input.trim().length > 0, [status?.status, input])

  const startSession = useCallback(async () => {
    try {
      await invoke<void>(TauriCommands.SchaltwerkAcpStartSession, { sessionName })
    } catch (error) {
      logger.error('[AcpChatPanel] Failed to start ACP session', error)
      setStatus({ sessionName, status: 'error', message: String(error) })
      setItems((prev) => [
        ...prev,
        { kind: 'status', id: stableId('status'), status: 'error', message: String(error) },
      ])
    }
  }, [sessionName])

  useEffect(() => {
    setStatus(null)
    setItems([])
    setToolCalls({})
    setTerminalOutputs({})
    setPendingPermission(null)
    void startSession()
  }, [sessionName, startSession])

  useEffect(() => {
    let cancelled = false
    const unlisten: Array<() => void> = []

    void (async () => {
      try {
        const offStatus = await listenEvent(SchaltEvent.AcpSessionStatus, (payload) => {
          if (cancelled || payload.sessionName !== sessionName) return
          setStatus(payload)
          setItems((prev) => [
            ...prev,
            { kind: 'status', id: stableId('status'), status: payload.status, message: payload.message },
          ])
        })
        unlisten.push(offStatus)

        const offUpdate = await listenEvent(SchaltEvent.AcpSessionUpdate, (payload: AcpSessionUpdatePayload) => {
          if (cancelled || payload.sessionName !== sessionName) return
          const update = payload.update
          if (!isRecord(update)) return
          const updateKind = getString(update, 'sessionUpdate')
          if (!updateKind) return

          if (updateKind === 'agent_message_chunk' || updateKind === 'user_message_chunk' || updateKind === 'agent_thought_chunk') {
            const content = isRecord(update.content) ? update.content : null
            const contentType = content ? getString(content, 'type') : null
            const role: 'user' | 'assistant' | 'thought' =
              updateKind === 'user_message_chunk' ? 'user' : updateKind === 'agent_thought_chunk' ? 'thought' : 'assistant'

            let text = ''
            if (contentType === 'text') {
              text = getString(content, 'text') ?? ''
            } else {
              text = JSON.stringify(content ?? update, null, 2)
            }

            if (text.length === 0) return

            setItems((prev) => {
              const last = prev[prev.length - 1]
              if (last && last.kind === 'message' && last.role === role) {
                const next = [...prev]
                next[next.length - 1] = { ...last, text: last.text + text }
                return next
              }
              return [...prev, { kind: 'message', id: stableId('msg'), role, text }]
            })
            return
          }

          if (updateKind === 'tool_call') {
            const toolCallId = getString(update, 'toolCallId')
            if (!toolCallId) return
            setToolCalls((prev) => ({ ...prev, [toolCallId]: update }))
            setItems((prev) => [...prev, { kind: 'tool_call', id: stableId('tool'), toolCallId }])
            return
          }

          if (updateKind === 'tool_call_update') {
            const toolCallId = getString(update, 'toolCallId')
            if (!toolCallId) return
            setToolCalls((prev) => ({ ...prev, [toolCallId]: { ...(prev[toolCallId] ?? {}), ...update } }))
            return
          }

          if (updateKind === 'plan') {
            setItems((prev) => [...prev, { kind: 'plan', id: stableId('plan'), plan: update }])
          }
        })
        unlisten.push(offUpdate)

        const offPermission = await listenEvent(
          SchaltEvent.AcpPermissionRequested,
          (payload: AcpPermissionRequestPayload) => {
            if (cancelled || payload.sessionName !== sessionName) return
            setPendingPermission(payload)
          }
        )
        unlisten.push(offPermission)

        const offTerminal = await listenEvent(SchaltEvent.AcpTerminalOutput, (payload: AcpTerminalOutputPayload) => {
          if (cancelled || payload.sessionName !== sessionName) return
          setTerminalOutputs((prev) => ({
            ...prev,
            [payload.terminalId]: {
              output: payload.output,
              truncated: payload.truncated,
              exitStatus: payload.exitStatus,
            },
          }))
        })
        unlisten.push(offTerminal)
      } catch (error) {
        logger.error('[AcpChatPanel] Failed to set up ACP listeners', error)
      }
    })()

    return () => {
      cancelled = true
      unlisten.forEach((fn) => fn())
    }
  }, [sessionName])

  useLayoutEffect(() => {
    bottomRef.current?.scrollIntoView({ block: 'end' })
  }, [items.length])

  const handleSend = useCallback(async () => {
    const text = input.trim()
    if (!text) return
    setInput('')
    setItems((prev) => [...prev, { kind: 'message', id: stableId('user'), role: 'user', text }])
    try {
      await invoke<void>(TauriCommands.SchaltwerkAcpPrompt, { sessionName, prompt: text })
    } catch (error) {
      logger.error('[AcpChatPanel] Failed to send prompt', error)
      setItems((prev) => [
        ...prev,
        { kind: 'status', id: stableId('status'), status: 'error', message: String(error) },
      ])
    }
  }, [input, sessionName])

  const handleSelectPermission = useCallback(
    async (requestId: AcpRequestId, optionId: string) => {
      setPendingPermission(null)
      try {
        await invoke<void>(TauriCommands.SchaltwerkAcpResolvePermission, {
          sessionName,
          requestId,
          optionId,
        })
      } catch (error) {
        logger.error('[AcpChatPanel] Failed to resolve permission', error)
        setItems((prev) => [
          ...prev,
          { kind: 'status', id: stableId('status'), status: 'error', message: String(error) },
        ])
      }
    },
    [sessionName]
  )

  const handleRestart = useCallback(async () => {
    setStatus({ sessionName, status: 'starting' })
    try {
      await invoke<void>(TauriCommands.SchaltwerkAcpStopSession, { sessionName })
    } catch (error) {
      logger.warn('[AcpChatPanel] Failed to stop ACP session (continuing to start)', error)
    }
    await startSession()
  }, [sessionName, startSession])

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: theme.colors.background.secondary }}>
      <div
        style={{
          borderBottom: `1px solid ${theme.colors.border.default}`,
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 10,
        }}
      >
        <div style={{ ...typography.label, color: theme.colors.text.primary }}>Claude Code</div>
        <div style={{ ...typography.caption, color: theme.colors.text.tertiary }}>
          {status ? status.status : 'starting'}
        </div>
        {status?.message && (
          <div style={{ ...typography.caption, color: theme.colors.text.muted, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {status.message}
          </div>
        )}
        <button
          onClick={() => void handleRestart()}
          style={{
            marginLeft: 'auto',
            backgroundColor: theme.colors.background.tertiary,
            border: `1px solid ${theme.colors.border.subtle}`,
            borderRadius: 8,
            padding: '6px 10px',
            cursor: 'pointer',
            color: theme.colors.text.secondary,
            ...typography.button,
          }}
        >
          Restart
        </button>
      </div>

      <div
        className="flex-1 min-h-0 overflow-auto"
        style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 12 }}
      >
        {items.map((item) => {
          if (item.kind === 'status') {
            return (
              <div
                key={item.id}
                style={{
                  border: `1px solid ${theme.colors.border.subtle}`,
                  borderRadius: 8,
                  padding: 10,
                  backgroundColor: theme.colors.background.tertiary,
                }}
              >
                <div style={{ ...typography.caption, color: theme.colors.text.tertiary }}>{item.status}</div>
                {item.message && (
                  <div style={{ ...typography.body, color: theme.colors.text.secondary, marginTop: 6 }}>
                    {item.message}
                  </div>
                )}
              </div>
            )
          }

          if (item.kind === 'message') {
            const bubbleBg =
              item.role === 'user' ? theme.colors.background.elevated : theme.colors.background.tertiary
            const label =
              item.role === 'user' ? 'You' : item.role === 'thought' ? 'Thought' : 'Claude'
            return (
              <div
                key={item.id}
                style={{
                  border: `1px solid ${theme.colors.border.subtle}`,
                  borderRadius: 10,
                  padding: 12,
                  backgroundColor: bubbleBg,
                }}
              >
                <div style={{ ...typography.caption, color: theme.colors.text.tertiary, marginBottom: 8 }}>
                  {label}
                </div>
                <div style={{ ...typography.body, color: theme.colors.text.primary, whiteSpace: 'pre-wrap' }}>
                  <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                    {item.text}
                  </ReactMarkdown>
                </div>
              </div>
            )
          }

          if (item.kind === 'tool_call') {
            const toolCall = toolCalls[item.toolCallId]
            if (!toolCall) return null
            return (
              <ToolCallView
                key={item.id}
                toolCall={toolCall}
                terminalOutputs={terminalOutputs}
              />
            )
          }

          if (item.kind === 'plan') {
            return (
              <pre
                key={item.id}
                style={{
                  margin: 0,
                  backgroundColor: theme.colors.background.elevated,
                  borderRadius: 8,
                  padding: 12,
                  overflowX: 'auto',
                  ...typography.code,
                  color: theme.colors.text.primary,
                }}
              >
                {JSON.stringify(item.plan, null, 2)}
              </pre>
            )
          }

          return null
        })}
        <div ref={bottomRef} />
      </div>

      <div style={{ borderTop: `1px solid ${theme.colors.border.default}`, padding: 12 }}>
        <div style={{ display: 'flex', gap: 10 }}>
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={status?.status === 'ready' ? 'Send a message…' : 'Starting…'}
            disabled={status?.status !== 'ready'}
            rows={3}
            style={{
              flex: 1,
              resize: 'none',
              borderRadius: 10,
              border: `1px solid ${theme.colors.border.subtle}`,
              backgroundColor: theme.colors.background.tertiary,
              color: theme.colors.text.primary,
              padding: '10px 12px',
              outline: 'none',
              ...typography.input,
            }}
          />
          <button
            onClick={() => { void handleSend() }}
            disabled={!canSend}
            style={{
              borderRadius: 10,
              border: `1px solid ${theme.colors.border.subtle}`,
              backgroundColor: canSend ? theme.colors.accent.blue.bg : theme.colors.background.tertiary,
              color: canSend ? theme.colors.accent.blue.light : theme.colors.text.tertiary,
              padding: '10px 14px',
              cursor: canSend ? 'pointer' : 'not-allowed',
              ...typography.button,
            }}
          >
            Send
          </button>
        </div>
      </div>

      {pendingPermission && (
        <PermissionPrompt
          request={pendingPermission}
          onDismiss={() => setPendingPermission(null)}
          onSelect={(optionId) => void handleSelectPermission(pendingPermission.requestId, optionId)}
        />
      )}
    </div>
  )
}
