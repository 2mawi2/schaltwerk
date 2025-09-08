import { invoke } from '@tauri-apps/api/core'
import { getActionButtonColorClasses } from '../constants/actionButtonColors'
import { logger } from '../utils/logger'

export interface HeaderActionConfig {
  id: string
  label: string
  prompt: string
  color?: string
}

interface ActionButtonProps {
  action: HeaderActionConfig
  projectId: string
  onExecute?: (action: HeaderActionConfig) => void
}

export function ActionButton({ action, projectId, onExecute }: ActionButtonProps) {
  const handleClick = async () => {
    try {
      const terminalId = `orchestrator-${projectId}-top`

      // Use paste_and_submit_terminal to properly paste into AI session
      await invoke('paste_and_submit_terminal', {
        id: terminalId,
        data: action.prompt
      })

      onExecute?.(action)
    } catch (error) {
      logger.error(`Failed to execute action "${action.label}":`, error)
    }
  }

  return (
    <button
      onClick={handleClick}
      className={`h-6 px-2 inline-flex items-center justify-center rounded transition-colors mr-2 text-xs ${getActionButtonColorClasses(action.color)}`}
      title={action.label}
      aria-label={action.label}
    >
      <span>{action.label}</span>
    </button>
  )
}