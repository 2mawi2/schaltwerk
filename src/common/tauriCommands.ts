// Centralized Tauri command names used by the frontend
export const TauriCommands = {
  SchaltwerkCoreGetSession: 'schaltwerk_core_get_session',
} as const

export type TauriCommand = typeof TauriCommands[keyof typeof TauriCommands]

