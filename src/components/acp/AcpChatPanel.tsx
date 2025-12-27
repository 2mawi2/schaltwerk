import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown, { type Components } from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  VscAccount,
  VscChevronRight,
  VscCopy,
  VscDebugConsole,
  VscDiff,
  VscEdit,
  VscFile,
  VscLightbulb,
  VscListSelection,
  VscRefresh,
  VscRobot,
  VscSearch,
  VscStopCircle,
  VscTerminal,
} from 'react-icons/vsc'
import { useAtomValue, useSetAtom } from 'jotai'
import { withOpacity } from '../../common/colorUtils'
import { theme } from '../../common/theme'
import { typography } from '../../common/typography'
import { logger } from '../../utils/logger'
import type {
  AcpPermissionRequestPayload,
  AcpRequestId,
} from '../../common/events'
import type { ChatItem, ToolCallState, TerminalOutputState } from '../../types/acp'
import {
  acpChatStateAtomFamily,
  dismissAcpPermissionPromptActionAtom,
  ensureAcpSessionStartedActionAtom,
  resolveAcpPermissionActionAtom,
  sendAcpPromptActionAtom,
  setAcpInputActionAtom,
  stopAcpSessionActionAtom,
} from '../../store/atoms/acp'

type StatusPalette = {
  bg: string
  border: string
  text: string
  solid: string
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

function toJson(value: unknown): string {
  return JSON.stringify(value, null, 2)
}

function statusPalette(status: string | null | undefined): StatusPalette | null {
  const normalized = status?.toLowerCase() ?? ''
  if (normalized.includes('error') || normalized.includes('failed')) {
    return {
      bg: theme.colors.accent.red.bg,
      border: theme.colors.accent.red.border,
      text: theme.colors.accent.red.light,
      solid: theme.colors.accent.red.DEFAULT,
    }
  }
  if (normalized.includes('success') || normalized.includes('completed') || normalized.includes('done')) {
    return {
      bg: theme.colors.accent.green.bg,
      border: theme.colors.accent.green.border,
      text: theme.colors.accent.green.light,
      solid: theme.colors.accent.green.DEFAULT,
    }
  }
  if (normalized.includes('running') || normalized.includes('progress') || normalized.includes('started')) {
    return {
      bg: theme.colors.accent.cyan.bg,
      border: theme.colors.accent.cyan.border,
      text: theme.colors.accent.cyan.light,
      solid: theme.colors.accent.cyan.DEFAULT,
    }
  }
  if (normalized.includes('waiting') || normalized.includes('pending') || normalized.includes('queued')) {
    return {
      bg: theme.colors.accent.amber.bg,
      border: theme.colors.accent.amber.border,
      text: theme.colors.accent.amber.light,
      solid: theme.colors.accent.amber.DEFAULT,
    }
  }
  return null
}

function useAutoResizeTextArea(textareaRef: React.RefObject<HTMLTextAreaElement | null>, value: string) {
  useLayoutEffect(() => {
    const el = textareaRef.current
    if (!el) return

    const maxHeight = 220
    el.style.height = 'auto'
    const nextHeight = Math.min(el.scrollHeight, maxHeight)
    el.style.height = `${nextHeight}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [textareaRef, value])
}

function IconBadge({
  icon,
  palette,
}: {
  icon: React.ReactNode
  palette: Pick<StatusPalette, 'bg' | 'border' | 'text'>
}) {
  return (
    <div
      style={{
        width: 24,
        height: 24,
        borderRadius: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: palette.bg,
        border: `1px solid ${palette.border}`,
        color: palette.text,
        flex: '0 0 auto',
      }}
      aria-hidden="true"
    >
      {icon}
    </div>
  )
}

function Pill({ label, palette }: { label: string; palette: StatusPalette | null }) {
  if (!label) return null
  const colors = palette ?? {
    bg: theme.colors.background.elevated,
    border: theme.colors.border.subtle,
    text: theme.colors.text.secondary,
    solid: theme.colors.text.secondary,
  }
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        borderRadius: 9999,
        padding: '3px 8px',
        backgroundColor: colors.bg,
        border: `1px solid ${colors.border}`,
        color: colors.text,
        ...typography.caption,
        whiteSpace: 'nowrap',
      }}
    >
      {label}
    </span>
  )
}

function StatusDot({ status }: { status: string }) {
  const normalized = status.toLowerCase()
  const solid =
    normalized === 'ready'
      ? theme.colors.status.success
      : normalized === 'error'
        ? theme.colors.status.error
        : normalized === 'starting'
          ? theme.colors.status.warning
          : theme.colors.text.muted
  return (
    <span
      style={{
        width: 8,
        height: 8,
        borderRadius: 9999,
        backgroundColor: solid,
        boxShadow: `0 0 0 4px ${withOpacity(solid, 0.18)}`,
        flex: '0 0 auto',
      }}
      aria-label={`status ${status}`}
      role="img"
    />
  )
}

function AcpDetails({
  title,
  subtitle,
  icon,
  defaultOpen,
  endSlot,
  children,
}: {
  title: string
  subtitle?: string | null
  icon: React.ReactNode
  defaultOpen?: boolean
  endSlot?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <details
      className="acp-details"
      open={defaultOpen}
      style={{
        border: `1px solid ${theme.colors.border.default}`,
        borderRadius: 10,
        backgroundColor: theme.colors.background.elevated,
        overflow: 'hidden',
      }}
    >
      <summary
        className="acp-details__summary"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '10px 12px',
          cursor: 'pointer',
          userSelect: 'none',
        }}
      >
        <VscChevronRight className="acp-details__chevron" aria-hidden="true" />
        {icon}
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ ...typography.label, color: theme.colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ ...typography.caption, color: theme.colors.text.tertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </div>
          )}
        </div>
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          {endSlot}
        </div>
      </summary>
      <div style={{ padding: 12 }}>{children}</div>
    </details>
  )
}

function JsonDetails({
  label,
  value,
}: {
  label: string
  value: unknown
}) {
  const [copied, setCopied] = useState(false)
  const json = useMemo(() => toJson(value), [value])

  useEffect(() => {
    setCopied(false)
  }, [json])

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(json)
      setCopied(true)
    } catch (error) {
      logger.warn('[AcpChatPanel] Failed to copy JSON', error)
    }
  }, [json])

  return (
    <AcpDetails
      title={label}
      subtitle={copied ? 'Copied' : null}
      icon={<VscDebugConsole aria-hidden="true" />}
      endSlot={
        <button
          type="button"
          onClick={(e) => {
            e.preventDefault()
            void handleCopy()
          }}
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            borderRadius: 10,
            padding: '6px 10px',
            backgroundColor: theme.colors.background.tertiary,
            border: `1px solid ${theme.colors.border.subtle}`,
            color: theme.colors.text.secondary,
            ...typography.button,
          }}
        >
          <VscCopy aria-hidden="true" />
          Copy
        </button>
      }
    >
      <pre
        style={{
          margin: 0,
          backgroundColor: theme.colors.background.primary,
          borderRadius: 10,
          padding: 12,
          overflow: 'auto',
          maxHeight: 320,
          ...typography.code,
          color: theme.colors.text.primary,
        }}
      >
        {json}
      </pre>
    </AcpDetails>
  )
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
  code: (props) => {
    const { children, className } = props
    const inline = (props as unknown as { inline?: boolean }).inline ?? false
    if (!inline) {
      return (
        <code
          className={className}
          style={{
            fontFamily: theme.fontFamily.mono,
            fontSize: theme.fontSize.code,
            color: theme.colors.text.primary,
          }}
        >
          {children}
        </code>
      )
    }
    return (
      <code
        style={{
          backgroundColor: theme.colors.background.elevated,
          color: theme.colors.text.primary,
          padding: '2px 6px',
          borderRadius: 6,
          fontFamily: theme.fontFamily.mono,
          fontSize: theme.fontSize.code,
          whiteSpace: 'pre-wrap',
        }}
      >
        {children}
      </code>
    )
  },
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
  const palette = statusPalette(status)
  const hasDiff = content.some((entry) => isRecord(entry) && entry.type === 'diff')
  const hasTerminal = content.some((entry) => isRecord(entry) && entry.type === 'terminal')
  const kindNormalized = kind?.toLowerCase() ?? ''

  const iconPalette: Pick<StatusPalette, 'bg' | 'border' | 'text'> =
    palette ?? {
      bg: withOpacity(theme.colors.text.primary, 0.05),
      border: withOpacity(theme.colors.text.primary, 0.12),
      text: theme.colors.text.tertiary,
    }

  const subtitle = [kind, status].filter(Boolean).join(' · ')
  const headerIcon = hasDiff ? (
    <VscDiff aria-hidden="true" />
  ) : hasTerminal ? (
    <VscTerminal aria-hidden="true" />
  ) : kindNormalized.includes('read') ? (
    <VscFile aria-hidden="true" />
  ) : kindNormalized.includes('glob') || kindNormalized.includes('search') ? (
    <VscSearch aria-hidden="true" />
  ) : kindNormalized.includes('edit') || kindNormalized.includes('write') ? (
    <VscEdit aria-hidden="true" />
  ) : (
    <VscDebugConsole aria-hidden="true" />
  )

  return (
    <div
      style={{
        border: `1px solid ${theme.colors.border.subtle}`,
        borderRadius: 14,
        padding: 12,
        backgroundColor: theme.colors.background.tertiary,
        boxShadow: `inset 0 1px 0 ${withOpacity(theme.colors.background.primary, 0.35)}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <IconBadge
          icon={headerIcon}
          palette={iconPalette}
        />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ ...typography.label, color: theme.colors.text.primary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
            {title}
          </div>
          {subtitle && (
            <div style={{ ...typography.caption, color: theme.colors.text.tertiary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {subtitle}
            </div>
          )}
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {status && <Pill label={status} palette={palette} />}
          {toolCallId && (
            <div
              style={{
                ...typography.caption,
                color: theme.colors.text.muted,
                fontFamily: theme.fontFamily.mono,
                maxWidth: 220,
                overflow: 'hidden',
                textOverflow: 'ellipsis',
                whiteSpace: 'nowrap',
              }}
              title={toolCallId}
            >
              {toolCallId}
            </div>
          )}
        </div>
      </div>

      {content.length > 0 && (
        <div style={{ display: 'flex', gap: 10, marginTop: 12 }}>
          <div style={{ width: 24, display: 'flex', justifyContent: 'center', alignItems: 'stretch' }} aria-hidden="true">
            <div
              style={{
                width: 2,
                flex: 1,
                borderRadius: 9999,
                backgroundColor: withOpacity(theme.colors.text.primary, 0.09),
              }}
            />
          </div>

          <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 12 }}>
            {content.map((entry, idx) => {
            if (!isRecord(entry) || typeof entry.type !== 'string') {
              return <JsonDetails key={idx} label="Tool output" value={entry} />
            }

          if (entry.type === 'diff') {
            const path = getString(entry, 'path') ?? 'unknown'
            const oldText = typeof entry.oldText === 'string' ? entry.oldText : entry.oldText === null ? null : null
            const newText = typeof entry.newText === 'string' ? entry.newText : ''

            const diffPalette: Pick<StatusPalette, 'bg' | 'border' | 'text'> = {
              bg: theme.colors.accent.violet.bg,
              border: theme.colors.accent.violet.border,
              text: theme.colors.accent.violet.light,
            }

            return (
              <AcpDetails
                key={idx}
                title="Diff"
                subtitle={path}
                icon={<IconBadge icon={<VscDiff aria-hidden="true" />} palette={diffPalette} />}
              >
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
                    gap: 12,
                  }}
                >
                  <div
                    style={{
                      border: `1px solid ${theme.colors.border.default}`,
                      borderRadius: 10,
                      overflow: 'hidden',
                      backgroundColor: theme.colors.background.primary,
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 10px',
                        backgroundColor: theme.colors.diff.removedBg,
                        borderBottom: `1px solid ${theme.colors.border.default}`,
                      }}
                    >
                      <div style={{ ...typography.caption, color: theme.colors.text.secondary }}>
                        {oldText === null ? 'No previous content' : 'Before'}
                      </div>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        maxHeight: 320,
                        overflow: 'auto',
                        whiteSpace: 'pre',
                        ...typography.code,
                        color: theme.colors.text.primary,
                      }}
                    >
                      {oldText ?? ''}
                    </pre>
                  </div>

                  <div
                    style={{
                      border: `1px solid ${theme.colors.border.default}`,
                      borderRadius: 10,
                      overflow: 'hidden',
                      backgroundColor: theme.colors.background.primary,
                    }}
                  >
                    <div
                      style={{
                        padding: '8px 10px',
                        backgroundColor: theme.colors.diff.addedBg,
                        borderBottom: `1px solid ${theme.colors.border.default}`,
                      }}
                    >
                      <div style={{ ...typography.caption, color: theme.colors.text.secondary }}>After</div>
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        padding: 12,
                        maxHeight: 320,
                        overflow: 'auto',
                        whiteSpace: 'pre',
                        ...typography.code,
                        color: theme.colors.text.primary,
                      }}
                    >
                      {newText}
                    </pre>
                  </div>
                </div>
              </AcpDetails>
            )
          }

	          if (entry.type === 'terminal') {
	            const terminalId = getString(entry, 'terminalId')
	            const output = terminalId ? terminalOutputs[terminalId] : null

	            const terminalPalette: Pick<StatusPalette, 'bg' | 'border' | 'text'> = {
	              bg: theme.colors.accent.cyan.bg,
	              border: theme.colors.accent.cyan.border,
	              text: theme.colors.accent.cyan.light,
	            }

	            const terminalPillPalette: StatusPalette = {
	              bg: terminalPalette.bg,
	              border: terminalPalette.border,
	              text: terminalPalette.text,
	              solid: theme.colors.accent.cyan.DEFAULT,
	            }

            return (
	              <AcpDetails
	                key={idx}
	                title="Terminal"
	                subtitle={terminalId ?? 'unknown'}
	                icon={<IconBadge icon={<VscTerminal aria-hidden="true" />} palette={terminalPalette} />}
	                endSlot={output?.truncated ? <Pill label="truncated" palette={terminalPillPalette} /> : null}
	              >
                {output?.exitStatus != null && (
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ ...typography.caption, color: theme.colors.text.tertiary, marginBottom: 6 }}>
                      Exit status
                    </div>
                    <pre
                      style={{
                        margin: 0,
                        backgroundColor: theme.colors.background.primary,
                        borderRadius: 10,
                        padding: 10,
                        overflowX: 'auto',
                        ...typography.code,
                        color: theme.colors.text.primary,
                      }}
                    >
                      {toJson(output.exitStatus)}
                    </pre>
                  </div>
                )}
                <pre
                  style={{
                    margin: 0,
                    backgroundColor: theme.colors.background.primary,
                    borderRadius: 10,
                    padding: 12,
                    maxHeight: 360,
                    overflow: 'auto',
                    whiteSpace: 'pre-wrap',
                    ...typography.terminal,
                    color: theme.colors.text.primary,
                  }}
                >
                  {output?.output ?? ''}
                </pre>
              </AcpDetails>
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
	            if (blockType === 'image') {
	              const data = getString(block, 'data')
	              const mimeType = getString(block, 'mimeType')
	              const uri = getString(block, 'uri')
	              const src = data && mimeType ? `data:${mimeType};base64,${data}` : uri
	              if (!src) {
	                return <JsonDetails key={idx} label="Image block" value={entry} />
	              }
	              return (
	                <AcpDetails
	                  key={idx}
	                  title="Image"
	                  icon={
	                    <IconBadge
	                      icon={<VscFile aria-hidden="true" />}
	                      palette={{
	                        bg: theme.colors.accent.cyan.bg,
	                        border: theme.colors.accent.cyan.border,
	                        text: theme.colors.accent.cyan.light,
	                      }}
	                    />
	                  }
	                >
	                  <div
	                    style={{
	                      borderRadius: 12,
	                      overflow: 'hidden',
	                      border: `1px solid ${theme.colors.border.subtle}`,
	                      backgroundColor: theme.colors.background.primary,
	                    }}
	                  >
	                    <img
	                      src={src}
	                      alt="ACP image"
	                      style={{
	                        display: 'block',
	                        maxWidth: '100%',
	                        maxHeight: 420,
	                        objectFit: 'contain',
	                        backgroundColor: theme.colors.background.primary,
	                      }}
	                    />
	                  </div>
	                </AcpDetails>
	              )
	            }
	            return <JsonDetails key={idx} label="Content block" value={entry} />
	          }

              return <JsonDetails key={idx} label="Tool output" value={entry} />
            })}
          </div>
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
  const toolCall = isRecord(request.toolCall) ? request.toolCall : null
  const toolTitle = toolCall ? getString(toolCall, 'title') : null
  const toolKind = toolCall ? getString(toolCall, 'kind') : null

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
          width: 560,
          maxWidth: '90vw',
          borderRadius: 14,
          backgroundColor: theme.colors.background.secondary,
          border: `1px solid ${theme.colors.border.default}`,
          padding: 18,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14 }}>
          <IconBadge
            icon={<VscLightbulb aria-hidden="true" />}
            palette={{
              bg: theme.colors.accent.amber.bg,
              border: theme.colors.accent.amber.border,
              text: theme.colors.accent.amber.light,
            }}
          />
          <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
            <div style={{ ...typography.heading, color: theme.colors.text.primary }}>Permission required</div>
            <div style={{ ...typography.body, color: theme.colors.text.secondary }}>
              {toolTitle ? `${toolTitle}${toolKind ? ` · ${toolKind}` : ''}` : 'Claude wants to run a tool.'}
            </div>
          </div>
          <button
            onClick={onDismiss}
            style={{
              marginLeft: 'auto',
              backgroundColor: theme.colors.background.tertiary,
              border: `1px solid ${theme.colors.border.subtle}`,
              borderRadius: 12,
              padding: '6px 10px',
              color: theme.colors.text.secondary,
              ...typography.button,
              cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {options.map((opt) => (
            <button
              key={opt.optionId}
              onClick={() => onSelect(opt.optionId)}
              style={{
                textAlign: 'left',
                backgroundColor: theme.colors.background.tertiary,
                border: `1px solid ${theme.colors.border.subtle}`,
                borderRadius: 14,
                padding: '12px 12px',
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

        <div style={{ marginTop: 12 }}>
          <JsonDetails label="Tool call details" value={request.toolCall} />
        </div>
      </div>
    </div>
  )
}

function HeaderButton({
  icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ReactNode
  label: string
  onClick: () => void
  disabled?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 8,
        borderRadius: 12,
        padding: '6px 10px',
        backgroundColor: theme.colors.background.tertiary,
        border: `1px solid ${theme.colors.border.subtle}`,
        color: disabled ? theme.colors.text.muted : theme.colors.text.secondary,
        ...typography.button,
      }}
    >
      {icon}
      {label}
    </button>
  )
}

function StatusItemView({ item }: { item: Extract<ChatItem, { kind: 'status' }> }) {
  const palette = statusPalette(item.status)
  const message = item.message?.trim() ?? ''

  return (
    <div style={{ display: 'flex', justifyContent: 'center' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          maxWidth: 900,
          borderRadius: 9999,
          padding: '6px 10px',
          border: `1px solid ${theme.colors.border.subtle}`,
          backgroundColor: theme.colors.background.tertiary,
        }}
      >
        <StatusDot status={item.status} />
        <div style={{ ...typography.caption, color: theme.colors.text.tertiary, whiteSpace: 'nowrap' }}>{item.status}</div>
        {message.length > 0 && (
          <div
            style={{
              ...typography.caption,
              color: theme.colors.text.secondary,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
            title={message}
          >
            {message}
          </div>
        )}
        {palette && <span style={{ width: 8, height: 8, borderRadius: 9999, backgroundColor: palette.solid, marginLeft: 2 }} />}
      </div>
    </div>
  )
}

function PlanView({ item }: { item: Extract<ChatItem, { kind: 'plan' }> }) {
  const plan = isRecord(item.plan) ? item.plan : null
  const entries = plan ? getArray(plan, 'entries') ?? [] : []
  const parsedEntries = entries
    .map((raw) => {
      if (!isRecord(raw)) return null
      const content = getString(raw, 'content') ?? ''
      const status = getString(raw, 'status') ?? 'pending'
      if (!content.trim()) return null
      return { content, status }
    })
    .filter(Boolean) as Array<{ content: string; status: string }>

  if (parsedEntries.length === 0) {
    return <JsonDetails label="Plan" value={item.plan} />
  }

  return (
    <div
      style={{
        border: `1px solid ${theme.colors.border.subtle}`,
        borderRadius: 14,
        padding: 12,
        backgroundColor: theme.colors.background.tertiary,
        boxShadow: `inset 0 1px 0 ${withOpacity(theme.colors.background.primary, 0.35)}`,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
        <IconBadge
          icon={<VscListSelection aria-hidden="true" />}
          palette={{
            bg: theme.colors.accent.violet.bg,
            border: theme.colors.accent.violet.border,
            text: theme.colors.accent.violet.light,
          }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ ...typography.label, color: theme.colors.text.primary }}>TODOs</div>
          <div style={{ ...typography.caption, color: theme.colors.text.tertiary }}>
            {parsedEntries.length} {parsedEntries.length === 1 ? 'item' : 'items'}
          </div>
        </div>
      </div>

      <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        {parsedEntries.map((entry, idx) => {
          const palette = statusPalette(entry.status)
          const dotColor = palette?.solid ?? theme.colors.border.strong

          return (
            <div
              key={`${idx}-${entry.content}`}
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                padding: '10px 12px',
                borderRadius: 12,
                border: `1px solid ${theme.colors.border.subtle}`,
                backgroundColor: theme.colors.background.secondary,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: 9999,
                  marginTop: 3,
                  backgroundColor: dotColor,
                  boxShadow: palette ? `0 0 0 4px ${withOpacity(palette.solid, 0.12)}` : undefined,
                }}
              />
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ ...typography.body, color: theme.colors.text.primary, whiteSpace: 'pre-wrap' }}>
                  {entry.content}
                </div>
                <div style={{ ...typography.caption, color: theme.colors.text.tertiary, marginTop: 4 }}>{entry.status}</div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function ChatMessageBubble({ item }: { item: Extract<ChatItem, { kind: 'message' }> }) {
  const isUser = item.role === 'user'
  const isThought = item.role === 'thought'

  const avatarPalette: Pick<StatusPalette, 'bg' | 'border' | 'text'> = isUser
    ? { bg: theme.colors.accent.blue.bg, border: theme.colors.accent.blue.border, text: theme.colors.accent.blue.light }
    : isThought
      ? { bg: theme.colors.accent.amber.bg, border: theme.colors.accent.amber.border, text: theme.colors.accent.amber.light }
      : { bg: theme.colors.accent.cyan.bg, border: theme.colors.accent.cyan.border, text: theme.colors.accent.cyan.light }

  const bubbleStyleUser: React.CSSProperties = {
    border: `1px solid ${theme.colors.border.subtle}`,
    borderRadius: 18,
    padding: '12px 14px',
    backgroundColor: theme.colors.background.elevated,
    color: theme.colors.text.primary,
    boxShadow: `inset 0 1px 0 ${withOpacity(theme.colors.background.primary, 0.25)}`,
  }

  const bubbleStyleThought: React.CSSProperties = {
    border: `1px dashed ${theme.colors.border.subtle}`,
    borderRadius: 16,
    padding: '12px 14px',
    backgroundColor: withOpacity(theme.colors.background.elevated, 0.25),
    color: theme.colors.text.primary,
  }

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: isUser ? 'flex-end' : 'flex-start',
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isUser ? 'row-reverse' : 'row',
    alignItems: 'flex-start',
    gap: 10,
    maxWidth: 'min(900px, 100%)',
    width: '100%',
  }

  const content = (
    <div style={{ ...typography.body, color: theme.colors.text.primary, whiteSpace: 'pre-wrap' }}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
        {item.text}
      </ReactMarkdown>
    </div>
  )

  return (
    <div style={wrapperStyle}>
      <div style={rowStyle}>
        <IconBadge
          icon={isUser ? <VscAccount aria-hidden="true" /> : isThought ? <VscLightbulb aria-hidden="true" /> : <VscRobot aria-hidden="true" />}
          palette={avatarPalette}
        />
        {isUser ? (
          <div style={{ ...bubbleStyleUser, width: '100%', maxWidth: 740 }}>{content}</div>
        ) : isThought ? (
          <details className="acp-details" style={{ ...bubbleStyleThought, width: '100%', maxWidth: 740 }}>
            <summary
              className="acp-details__summary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                userSelect: 'none',
                padding: 0,
              }}
            >
              <VscChevronRight className="acp-details__chevron" aria-hidden="true" />
              <div style={{ ...typography.caption, color: theme.colors.text.tertiary }}>Thinking</div>
            </summary>
            <div style={{ marginTop: 10 }}>{content}</div>
          </details>
        ) : (
          <div style={{ width: '100%', maxWidth: 740, padding: '2px 0' }}>{content}</div>
        )}
      </div>
    </div>
	)
}

function ChatImageBubble({ item }: { item: Extract<ChatItem, { kind: 'image' }> }) {
  const isUser = item.role === 'user'
  const isThought = item.role === 'thought'
  const data = item.image.data ?? null
  const mimeType = item.image.mimeType ?? null
  const uri = item.image.uri ?? null
  const src = data && mimeType ? `data:${mimeType};base64,${data}` : uri

  const avatarPalette: Pick<StatusPalette, 'bg' | 'border' | 'text'> = isUser
    ? { bg: theme.colors.accent.blue.bg, border: theme.colors.accent.blue.border, text: theme.colors.accent.blue.light }
    : isThought
      ? { bg: theme.colors.accent.amber.bg, border: theme.colors.accent.amber.border, text: theme.colors.accent.amber.light }
      : { bg: theme.colors.accent.cyan.bg, border: theme.colors.accent.cyan.border, text: theme.colors.accent.cyan.light }

  const wrapperStyle: React.CSSProperties = {
    display: 'flex',
    justifyContent: isUser ? 'flex-end' : 'flex-start',
  }

  const rowStyle: React.CSSProperties = {
    display: 'flex',
    flexDirection: isUser ? 'row-reverse' : 'row',
    alignItems: 'flex-start',
    gap: 10,
    maxWidth: 'min(900px, 100%)',
    width: '100%',
  }

  if (!src) {
    return (
      <div style={wrapperStyle}>
        <div style={rowStyle}>
          <IconBadge
            icon={isUser ? <VscAccount aria-hidden="true" /> : isThought ? <VscLightbulb aria-hidden="true" /> : <VscRobot aria-hidden="true" />}
            palette={avatarPalette}
          />
          <div style={{ width: '100%', maxWidth: 740 }}>
            <JsonDetails label="Image" value={item.image} />
          </div>
        </div>
      </div>
    )
  }

  const imageBody = (
    <div
      style={{
        borderRadius: 16,
        overflow: 'hidden',
        border: `1px solid ${theme.colors.border.subtle}`,
        backgroundColor: theme.colors.background.primary,
        boxShadow: `inset 0 1px 0 ${withOpacity(theme.colors.background.primary, 0.25)}`,
      }}
    >
      <img
        src={src}
        alt="ACP image"
        style={{
          display: 'block',
          maxWidth: '100%',
          maxHeight: 520,
          objectFit: 'contain',
          backgroundColor: theme.colors.background.primary,
        }}
      />
    </div>
  )

  return (
    <div style={wrapperStyle}>
      <div style={rowStyle}>
        <IconBadge
          icon={isUser ? <VscAccount aria-hidden="true" /> : isThought ? <VscLightbulb aria-hidden="true" /> : <VscRobot aria-hidden="true" />}
          palette={avatarPalette}
        />
        {isThought ? (
          <details className="acp-details" style={{ width: '100%', maxWidth: 740, border: `1px dashed ${theme.colors.border.subtle}`, borderRadius: 16, padding: '12px 14px', backgroundColor: withOpacity(theme.colors.background.elevated, 0.25) }}>
            <summary
              className="acp-details__summary"
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                cursor: 'pointer',
                userSelect: 'none',
                padding: 0,
              }}
            >
              <VscChevronRight className="acp-details__chevron" aria-hidden="true" />
              <div style={{ ...typography.caption, color: theme.colors.text.tertiary }}>Thinking (image)</div>
            </summary>
            <div style={{ marginTop: 10 }}>{imageBody}</div>
          </details>
        ) : (
          <div style={{ width: '100%', maxWidth: 740 }}>{imageBody}</div>
        )}
      </div>
    </div>
  )
}

export function AcpChatPanel({ sessionName }: { sessionName: string }) {
  const state = useAtomValue(acpChatStateAtomFamily(sessionName))
  const ensureSessionStarted = useSetAtom(ensureAcpSessionStartedActionAtom)
  const sendPrompt = useSetAtom(sendAcpPromptActionAtom)
  const stopSession = useSetAtom(stopAcpSessionActionAtom)
  const setInput = useSetAtom(setAcpInputActionAtom)
  const resolvePermission = useSetAtom(resolveAcpPermissionActionAtom)
  const dismissPermission = useSetAtom(dismissAcpPermissionPromptActionAtom)

  const { status, items, toolCalls, terminalOutputs, pendingPermission, input } = state
  const bottomRef = useRef<HTMLDivElement | null>(null)
  const scrollContainerRef = useRef<HTMLDivElement | null>(null)
  const isNearBottomRef = useRef(true)
  const textareaRef = useRef<HTMLTextAreaElement | null>(null)
  const canSend = useMemo(() => status?.status === 'ready' && input.trim().length > 0, [status?.status, input])

  useAutoResizeTextArea(textareaRef, input)

  useEffect(() => {
    void ensureSessionStarted({ sessionName })
  }, [ensureSessionStarted, sessionName])

  useEffect(() => {
    const el = scrollContainerRef.current
    if (!el) return

    const update = () => {
      const distanceToBottom = el.scrollHeight - el.scrollTop - el.clientHeight
      isNearBottomRef.current = distanceToBottom < 140
    }

    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => {
      el.removeEventListener('scroll', update)
    }
  }, [])

  useLayoutEffect(() => {
    if (!isNearBottomRef.current) return
    bottomRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [items])

  const handleSend = useCallback(async () => {
    if (status?.status !== 'ready') return
    await sendPrompt({ sessionName })
  }, [sendPrompt, sessionName, status?.status])

  const handleSelectPermission = useCallback(
    async (requestId: AcpRequestId, optionId: string) => {
      await resolvePermission({ sessionName, requestId, optionId })
    },
    [resolvePermission, sessionName]
  )

  const handleRestart = useCallback(async () => {
    await stopSession({ sessionName })
    await ensureSessionStarted({ sessionName })
  }, [ensureSessionStarted, sessionName, stopSession])

  const handleStop = useCallback(async () => {
    await stopSession({ sessionName })
  }, [sessionName, stopSession])

  const statusValue = status?.status ?? 'starting'
  const placeholder =
    statusValue === 'ready'
      ? 'Send a message…'
      : statusValue === 'error'
        ? 'Restart to reconnect…'
        : statusValue === 'stopped'
          ? 'Click Restart to start…'
          : 'Starting…'

  const hintText =
    statusValue === 'ready'
      ? 'Enter to send · Shift+Enter for newline'
      : statusValue === 'stopped'
        ? 'Click Restart to start…'
        : statusValue === 'error'
          ? 'Restart to reconnect…'
          : 'Claude Code is starting…'

  return (
    <div className="h-full w-full flex flex-col" style={{ backgroundColor: theme.colors.background.secondary }}>
      <div
        style={{
          position: 'sticky',
          top: 0,
          zIndex: 10,
          borderBottom: `1px solid ${theme.colors.border.default}`,
          padding: '10px 12px',
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          backgroundColor: withOpacity(theme.colors.background.secondary, 0.92),
          backdropFilter: 'blur(12px)',
        }}
      >
        <StatusDot status={statusValue} />
        <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
          <div style={{ ...typography.label, color: theme.colors.text.primary }}>Claude Code</div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
            <div style={{ ...typography.caption, color: theme.colors.text.tertiary, whiteSpace: 'nowrap' }}>{statusValue}</div>
            {status?.message && (
              <div
                style={{
                  ...typography.caption,
                  color: theme.colors.text.muted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={status.message ?? ''}
              >
                {status.message}
              </div>
            )}
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 8 }}>
          <HeaderButton icon={<VscRefresh aria-hidden="true" />} label="Restart" onClick={() => { void handleRestart() }} />
          <HeaderButton
            icon={<VscStopCircle aria-hidden="true" />}
            label="Stop"
            disabled={statusValue !== 'ready'}
            onClick={() => { void handleStop() }}
          />
        </div>
      </div>

      <div
        ref={scrollContainerRef}
        className="flex-1 min-h-0 overflow-auto custom-scrollbar"
        style={{ padding: 16 }}
      >
        <div
          style={{
            maxWidth: 980,
            margin: '0 auto',
            display: 'flex',
            flexDirection: 'column',
            gap: 14,
            paddingBottom: 16,
          }}
        >
          {items.length === 0 && (
            <div
              style={{
                padding: '48px 0',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
                textAlign: 'center',
              }}
            >
              <IconBadge
                icon={<VscRobot aria-hidden="true" />}
                palette={{ bg: theme.colors.accent.cyan.bg, border: theme.colors.accent.cyan.border, text: theme.colors.accent.cyan.light }}
              />
              <div style={{ ...typography.headingLarge, color: theme.colors.text.primary }}>
                What would you like to work on?
              </div>
              <div style={{ ...typography.body, color: theme.colors.text.secondary, maxWidth: 560 }}>
                Claude Code runs inside your session worktree. Ask questions, request edits, and review diffs and tool output right here.
              </div>
            </div>
          )}

	          {items.map((item) => {
	            if (item.kind === 'status') {
	              return <StatusItemView key={item.id} item={item} />
	            }

	            if (item.kind === 'message') {
	              return <ChatMessageBubble key={item.id} item={item} />
	            }

	            if (item.kind === 'image') {
	              return <ChatImageBubble key={item.id} item={item} />
	            }

	            if (item.kind === 'tool_call') {
	              const toolCall = toolCalls[item.toolCallId]
	              if (!toolCall) return null
	              return <ToolCallView key={item.id} toolCall={toolCall} terminalOutputs={terminalOutputs} />
	            }

	            if (item.kind === 'plan') {
	              return <PlanView key={item.id} item={item} />
	            }

	            return null
	          })}
          <div ref={bottomRef} />
        </div>
      </div>

      <div
        style={{
          borderTop: `1px solid ${theme.colors.border.default}`,
          padding: 14,
          backgroundColor: withOpacity(theme.colors.background.secondary, 0.96),
          backdropFilter: 'blur(10px)',
        }}
      >
        <div style={{ maxWidth: 980, margin: '0 auto' }}>
          <div
            style={{
              border: `1px solid ${theme.colors.border.subtle}`,
              borderRadius: 16,
              backgroundColor: theme.colors.background.tertiary,
              padding: 12,
              boxShadow: `inset 0 1px 0 ${withOpacity(theme.colors.background.primary, 0.25)}`,
            }}
          >
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput({ sessionName, input: e.target.value })}
              onKeyDown={(e) => {
                if (e.key !== 'Enter' || e.shiftKey) return
                e.preventDefault()
                void handleSend()
              }}
              placeholder={placeholder}
              rows={1}
              style={{
                width: '100%',
                resize: 'none',
                border: 'none',
                backgroundColor: 'transparent',
                color: theme.colors.text.primary,
                outline: 'none',
                ...typography.input,
              }}
            />

            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 10 }}>
              <div style={{ ...typography.caption, color: theme.colors.text.muted, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {hintText}
              </div>
              <div style={{ marginLeft: 'auto' }}>
                <button
                  type="button"
                  onClick={() => { void handleSend() }}
                  disabled={!canSend}
                  style={{
                    borderRadius: 12,
                    border: `1px solid ${canSend ? theme.colors.accent.blue.border : theme.colors.border.subtle}`,
                    backgroundColor: canSend ? theme.colors.accent.blue.DEFAULT : theme.colors.background.elevated,
                    color: canSend ? theme.colors.text.inverse : theme.colors.text.tertiary,
                    padding: '8px 14px',
                    ...typography.button,
                  }}
                >
                  Send
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {pendingPermission && (
        <PermissionPrompt
          request={pendingPermission}
          onDismiss={() => dismissPermission({ sessionName })}
          onSelect={(optionId) => void handleSelectPermission(pendingPermission.requestId, optionId)}
        />
      )}
    </div>
  )
}
