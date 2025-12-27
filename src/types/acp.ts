import type { AcpPermissionRequestPayload, AcpSessionStatusPayload } from '../common/events'

export type ChatItem =
  | { kind: 'status'; id: string; status: string; message?: string | null }
  | { kind: 'message'; id: string; role: 'user' | 'assistant' | 'thought'; text: string }
  | {
      kind: 'image'
      id: string
      role: 'user' | 'assistant' | 'thought'
      image: { data?: string | null; mimeType?: string | null; uri?: string | null }
    }
  | { kind: 'tool_call'; id: string; toolCallId: string }
  | { kind: 'plan'; id: string; plan: unknown }

export type ToolCallState = Record<string, unknown>

export type TerminalOutputState = {
  output: string
  truncated: boolean
  exitStatus?: unknown
}

export type ClaudeTopViewMode = 'rich' | 'terminal'

export interface AcpChatState {
  status: AcpSessionStatusPayload | null
  items: ChatItem[]
  toolCalls: Record<string, ToolCallState>
  terminalOutputs: Record<string, TerminalOutputState>
  pendingPermission: AcpPermissionRequestPayload | null
  input: string
}

