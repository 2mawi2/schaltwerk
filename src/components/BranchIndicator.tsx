import { useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscSourceControl } from 'react-icons/vsc'
import { TauriCommands } from '../common/tauriCommands'
import { theme } from '../common/theme'
import { logger } from '../utils/logger'
import type { CSSProperties } from 'react'

interface DevelopmentInfo {
  isDevelopment: boolean
  isWorktree: boolean
  branch: string | null
  sessionName: string | null
}

const codeFontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace'

const containerStyle: CSSProperties = {
  display: 'inline-flex',
  alignItems: 'center',
  gap: theme.spacing.xs,
  marginRight: theme.spacing.sm,
  padding: `${theme.spacing.xs} ${theme.spacing.sm}`,
  backgroundColor: theme.colors.accent.blue.bg,
  border: `1px solid ${theme.colors.accent.blue.border}`,
  borderRadius: theme.borderRadius.lg,
  color: theme.colors.accent.blue.light,
  fontSize: theme.fontSize.caption,
  lineHeight: 1.2,
}

const badgeTextStyle: CSSProperties = {
  fontFamily: codeFontFamily,
  color: theme.colors.accent.blue.light,
}

export function BranchIndicator() {
  const [devInfo, setDevInfo] = useState<DevelopmentInfo | null>(null)

  useEffect(() => {
    const loadDevInfo = async () => {
      try {
        const info = await invoke<DevelopmentInfo>(TauriCommands.GetDevelopmentInfo)
        setDevInfo(info)
      } catch (error) {
        logger.error('[BranchIndicator] Failed to get development info:', error)
      }
    }

    void loadDevInfo()
  }, [])

  const shouldShow = Boolean(
    devInfo?.branch && (devInfo.isDevelopment || devInfo.isWorktree)
  )

  if (!shouldShow || !devInfo) {
    return null
  }

  return (
    <div data-testid="branch-indicator" style={containerStyle}>
      <VscSourceControl size={14} aria-hidden="true" style={{ color: theme.colors.accent.blue.light }} />
      {devInfo.sessionName && (
        <span data-testid="branch-indicator-session" style={badgeTextStyle}>
          {devInfo.sessionName}
        </span>
      )}
      <span data-testid="branch-indicator-branch" style={badgeTextStyle}>
        {devInfo.branch}
      </span>
    </div>
  )
}
