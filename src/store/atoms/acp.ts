import { atom } from 'jotai'
import { atomFamily } from 'jotai/utils'
import { invoke } from '@tauri-apps/api/core'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import type {
  AcpPermissionRequestPayload,
  AcpSessionStatusPayload,
  AcpSessionUpdatePayload,
  AcpTerminalOutputPayload,
} from '../../common/events'
import type { AcpChatState, ChatItem, ClaudeTopViewMode, TerminalOutputState } from '../../types/acp'

const DEFAULT_ACP_STATE: AcpChatState = {
  status: null,
  items: [],
  toolCalls: {},
  terminalOutputs: {},
  pendingPermission: null,
  input: '',
}

export const acpChatStateAtomFamily = atomFamily(
  (_sessionName: string) => atom<AcpChatState>({ ...DEFAULT_ACP_STATE, items: [] }),
  (a, b) => a === b
)

export const claudeTopViewModeAtomFamily = atomFamily(
  (_sessionName: string) => atom<ClaudeTopViewMode>('rich'),
  (a, b) => a === b
)

let nextStableId = 0
function stableId(prefix: string): string {
  nextStableId += 1
  return `${prefix}-${nextStableId}`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function getString(value: unknown, key: string): string | null {
  if (!isRecord(value)) return null
  const v = value[key]
  return typeof v === 'string' ? v : null
}

function applyStatusUpdate(prev: AcpChatState, payload: AcpSessionStatusPayload): AcpChatState {
  const next: AcpChatState = { ...prev, status: payload }

  const shouldAppend =
    payload.status === 'error' ||
    payload.status === 'stopped' ||
    (payload.status === 'ready' && Boolean(payload.message))
  if (!shouldAppend) {
    return next
  }

  const last = prev.items[prev.items.length - 1]
  const lastMessage = last && last.kind === 'status' ? (last.message ?? null) : null
  const nextMessage = payload.message ?? null
  if (last && last.kind === 'status' && last.status === payload.status && lastMessage === nextMessage) {
    return next
  }

  return {
    ...next,
    items: [
      ...prev.items,
      { kind: 'status', id: stableId('status'), status: payload.status, message: payload.message } satisfies ChatItem,
    ],
  }
}

function applyTerminalOutputUpdate(
  prev: AcpChatState,
  payload: AcpTerminalOutputPayload
): AcpChatState {
  const terminal: TerminalOutputState = {
    output: payload.output,
    truncated: payload.truncated,
    exitStatus: payload.exitStatus,
  }
  return {
    ...prev,
    terminalOutputs: { ...prev.terminalOutputs, [payload.terminalId]: terminal },
  }
}

function applyPermissionRequestUpdate(
  prev: AcpChatState,
  payload: AcpPermissionRequestPayload
): AcpChatState {
  return { ...prev, pendingPermission: payload }
}

function applySessionUpdate(prev: AcpChatState, payload: AcpSessionUpdatePayload): AcpChatState {
  const update = payload.update
  if (!isRecord(update)) return prev
  const updateKind = getString(update, 'sessionUpdate')
  if (!updateKind) return prev

  if (updateKind === 'agent_message_chunk' || updateKind === 'user_message_chunk' || updateKind === 'agent_thought_chunk') {
    const content = isRecord(update.content) ? update.content : null
    const contentType = content ? getString(content, 'type') : null
    const role: 'user' | 'assistant' | 'thought' =
      updateKind === 'user_message_chunk' ? 'user' : updateKind === 'agent_thought_chunk' ? 'thought' : 'assistant'

    if (contentType === 'image') {
      const data = getString(content, 'data')
      const mimeType = getString(content, 'mimeType')
      const uri = getString(content, 'uri')

      if (!data && !uri) {
        return {
          ...prev,
          items: [
            ...prev.items,
            { kind: 'message', id: stableId('msg'), role, text: JSON.stringify(content ?? update, null, 2) } satisfies ChatItem,
          ],
        }
      }

      return {
        ...prev,
        items: [
          ...prev.items,
          { kind: 'image', id: stableId('img'), role, image: { data, mimeType, uri } } satisfies ChatItem,
        ],
      }
    }

    const text = contentType === 'text' ? getString(content, 'text') ?? '' : JSON.stringify(content ?? update, null, 2)
    if (text.length === 0) return prev

    const last = prev.items[prev.items.length - 1]
    if (last && last.kind === 'message' && last.role === role) {
      const nextItems = [...prev.items]
      nextItems[nextItems.length - 1] = { ...last, text: last.text + text }
      return { ...prev, items: nextItems }
    }

    return {
      ...prev,
      items: [...prev.items, { kind: 'message', id: stableId('msg'), role, text } satisfies ChatItem],
    }
  }

  if (updateKind === 'tool_call') {
    const toolCallId = getString(update, 'toolCallId')
    if (!toolCallId) return prev

    const alreadyAdded = prev.items.some((item) => item.kind === 'tool_call' && item.toolCallId === toolCallId)
    return {
      ...prev,
      toolCalls: { ...prev.toolCalls, [toolCallId]: update },
      items: alreadyAdded
        ? prev.items
        : [...prev.items, { kind: 'tool_call', id: stableId('tool'), toolCallId } satisfies ChatItem],
    }
  }

  if (updateKind === 'tool_call_update') {
    const toolCallId = getString(update, 'toolCallId')
    if (!toolCallId) return prev

    return {
      ...prev,
      toolCalls: {
        ...prev.toolCalls,
        [toolCallId]: { ...(prev.toolCalls[toolCallId] ?? {}), ...update },
      },
    }
  }

  if (updateKind === 'plan') {
    return {
      ...prev,
      items: [...prev.items, { kind: 'plan', id: stableId('plan'), plan: update } satisfies ChatItem],
    }
  }

  return prev
}

let acpEventsCleanup: (() => void) | null = null

export const initializeAcpEventsActionAtom = atom(
  null,
  async (_get, set) => {
    if (acpEventsCleanup) return

    const unlisteners: Array<() => void> = []

    const register = async <E extends SchaltEvent>(event: E, handler: (payload: unknown) => void) => {
      const unlisten = await listenEvent(event, (payload) => {
        try {
          handler(payload)
        } catch (error) {
          logger.error(`[AcpAtoms] Failed to handle ${event}:`, error)
        }
      })
      unlisteners.push(unlisten)
    }

    await register(SchaltEvent.AcpSessionStatus, (payload) => {
      const status = payload as AcpSessionStatusPayload
      if (!status?.sessionName) return
      set(acpChatStateAtomFamily(status.sessionName), (prev) => applyStatusUpdate(prev, status))
    })

    await register(SchaltEvent.AcpSessionUpdate, (payload) => {
      const update = payload as AcpSessionUpdatePayload
      if (!update?.sessionName) return
      set(acpChatStateAtomFamily(update.sessionName), (prev) => applySessionUpdate(prev, update))
    })

    await register(SchaltEvent.AcpPermissionRequested, (payload) => {
      const request = payload as AcpPermissionRequestPayload
      if (!request?.sessionName) return
      set(acpChatStateAtomFamily(request.sessionName), (prev) => applyPermissionRequestUpdate(prev, request))
    })

    await register(SchaltEvent.AcpTerminalOutput, (payload) => {
      const output = payload as AcpTerminalOutputPayload
      if (!output?.sessionName) return
      set(acpChatStateAtomFamily(output.sessionName), (prev) => applyTerminalOutputUpdate(prev, output))
    })

    acpEventsCleanup = () => {
      for (const unlisten of unlisteners) {
        try {
          unlisten()
        } catch {
          // ignore
        }
      }
      acpEventsCleanup = null
    }
  }
)

export const setAcpInputActionAtom = atom(
  null,
  (_get, set, params: { sessionName: string; input: string }) => {
    set(acpChatStateAtomFamily(params.sessionName), (prev) => ({ ...prev, input: params.input }))
  }
)

export const dismissAcpPermissionPromptActionAtom = atom(
  null,
  (_get, set, params: { sessionName: string }) => {
    set(acpChatStateAtomFamily(params.sessionName), (prev) => ({ ...prev, pendingPermission: null }))
  }
)

export const ensureAcpSessionStartedActionAtom = atom(
  null,
  async (_get, set, params: { sessionName: string }) => {
    try {
      await invoke<void>(TauriCommands.SchaltwerkAcpStartSession, { sessionName: params.sessionName })
    } catch (error) {
      logger.error('[AcpAtoms] Failed to start ACP session', error)
      const payload: AcpSessionStatusPayload = { sessionName: params.sessionName, status: 'error', message: String(error) }
      set(acpChatStateAtomFamily(params.sessionName), (prev) => applyStatusUpdate(prev, payload))
    }
  }
)

export const stopAcpSessionActionAtom = atom(
  null,
  async (_get, set, params: { sessionName: string }) => {
    set(acpChatStateAtomFamily(params.sessionName), (prev) => ({ ...prev, pendingPermission: null }))
    try {
      await invoke<void>(TauriCommands.SchaltwerkAcpStopSession, { sessionName: params.sessionName })
      const payload: AcpSessionStatusPayload = { sessionName: params.sessionName, status: 'stopped' }
      set(acpChatStateAtomFamily(params.sessionName), (prev) => applyStatusUpdate(prev, payload))
    } catch (error) {
      logger.error('[AcpAtoms] Failed to stop ACP session', error)
      const payload: AcpSessionStatusPayload = { sessionName: params.sessionName, status: 'error', message: String(error) }
      set(acpChatStateAtomFamily(params.sessionName), (prev) => applyStatusUpdate(prev, payload))
    }
  }
)

export const sendAcpPromptActionAtom = atom(
  null,
  async (get, set, params: { sessionName: string }) => {
    const state = get(acpChatStateAtomFamily(params.sessionName))
    if (state.status?.status !== 'ready') return
    const text = state.input.trim()
    if (!text) return

    set(acpChatStateAtomFamily(params.sessionName), (prev) => ({
      ...prev,
      input: '',
      items: [...prev.items, { kind: 'message', id: stableId('user'), role: 'user', text } satisfies ChatItem],
    }))

    try {
      await invoke<void>(TauriCommands.SchaltwerkAcpPrompt, { sessionName: params.sessionName, prompt: text })
    } catch (error) {
      logger.error('[AcpAtoms] Failed to send prompt', error)
      const payload: AcpSessionStatusPayload = { sessionName: params.sessionName, status: 'error', message: String(error) }
      set(acpChatStateAtomFamily(params.sessionName), (prev) => applyStatusUpdate(prev, payload))
    }
  }
)

export const resolveAcpPermissionActionAtom = atom(
  null,
  async (_get, set, params: { sessionName: string; requestId: unknown; optionId: string }) => {
    set(acpChatStateAtomFamily(params.sessionName), (prev) => ({ ...prev, pendingPermission: null }))
    try {
      await invoke<void>(TauriCommands.SchaltwerkAcpResolvePermission, {
        sessionName: params.sessionName,
        requestId: params.requestId,
        optionId: params.optionId,
      })
    } catch (error) {
      logger.error('[AcpAtoms] Failed to resolve permission', error)
      const payload: AcpSessionStatusPayload = { sessionName: params.sessionName, status: 'error', message: String(error) }
      set(acpChatStateAtomFamily(params.sessionName), (prev) => applyStatusUpdate(prev, payload))
    }
  }
)
