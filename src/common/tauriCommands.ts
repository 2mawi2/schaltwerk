// Centralized Tauri command names used by the frontend
export const TauriCommands = {
  SchaltwerkCoreGetSession: 'schaltwerk_core_get_session',
  SchaltwerkCoreCreateSession: 'schaltwerk_core_create_session',
  SchaltwerkCoreCreateSpecSession: 'schaltwerk_core_create_spec_session',
  SchaltwerkCoreCreateAndStartSpecSession: 'schaltwerk_core_create_and_start_spec_session',
  SchaltwerkCoreStartSpecSession: 'schaltwerk_core_start_spec_session',
  CreateTerminal: 'create_terminal',
} as const

export type TauriCommand = typeof TauriCommands[keyof typeof TauriCommands]
