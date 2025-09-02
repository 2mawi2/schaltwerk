// Centralized Tauri command names used by the frontend
export const TauriCommands = {
  SchaltwerkCoreGetSession: 'schaltwerk_core_get_session',
  SchaltwerkCoreCreateSession: 'schaltwerk_core_create_session',
} as const

export type TauriCommand = typeof TauriCommands[keyof typeof TauriCommands]
