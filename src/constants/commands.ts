// Deprecated: use TauriCommands from '../common/tauriCommands'
// Keep this file as a thin alias to avoid churn in imports.
import { TauriCommands as BaseTauriCommands } from '../common/tauriCommands'
export type { TauriCommand } from '../common/tauriCommands'
export const TauriCommands = BaseTauriCommands
// Back-compat export for older imports
export const TAURI_COMMANDS = TauriCommands
