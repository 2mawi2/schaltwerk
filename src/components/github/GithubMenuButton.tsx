import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FaGithub } from 'react-icons/fa'
import { VscRefresh } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useToast } from '../../common/toast/ToastProvider'
import { withOpacity } from '../../common/colorUtils'

interface GithubMenuButtonProps {
  className?: string
  hasActiveProject?: boolean
}

const menuContainerStyle: CSSProperties = {
  backgroundColor: theme.colors.background.elevated,
  border: `1px solid ${theme.colors.border.subtle}`,
  boxShadow: `0 12px 24px ${withOpacity(theme.colors.background.primary, 0.45)}`,
}

const dividerStyle: CSSProperties = {
  height: 1,
  width: '100%',
  backgroundColor: theme.colors.border.subtle,
  opacity: 0.6,
}

function useOutsideDismiss(ref: React.RefObject<HTMLElement | null>, onDismiss: () => void) {
  useEffect(() => {
    const listener = (event: MouseEvent) => {
      if (!ref.current || ref.current.contains(event.target as Node)) {
        return
      }
      onDismiss()
    }
    document.addEventListener('mousedown', listener)
    return () => document.removeEventListener('mousedown', listener)
  }, [ref, onDismiss])
}

export function GithubMenuButton({ className, hasActiveProject = false }: GithubMenuButtonProps) {
  const { pushToast } = useToast()
  const github = useGithubIntegrationContext()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useOutsideDismiss(menuRef, () => setOpen(false))

  const installed = github.status?.installed ?? false
  const authenticated = installed && (github.status?.authenticated ?? false)
  const repository = github.status?.repository ?? null
  const userLogin = github.status?.userLogin ?? null

  const overallState: 'missing' | 'unauthenticated' | 'disconnected' | 'connected' = !installed
    ? 'missing'
    : !authenticated
      ? 'unauthenticated'
      : repository
        ? 'connected'
        : 'disconnected'

  const indicatorColor = useMemo(() => {
    switch (overallState) {
      case 'connected':
        return theme.colors.accent.green.DEFAULT
      case 'disconnected':
        return theme.colors.accent.blue.DEFAULT
      case 'unauthenticated':
        return theme.colors.accent.amber.DEFAULT
      case 'missing':
      default:
        return theme.colors.accent.red.DEFAULT
    }
  }, [overallState])

  const statusLabel = useMemo(() => {
    switch (overallState) {
      case 'connected':
        return repository?.nameWithOwner || (userLogin ? `Signed in as ${userLogin}` : 'GitHub ready')
      case 'disconnected':
        return hasActiveProject ? 'Connect project' : 'No project selected'
      case 'unauthenticated':
        return 'Not authenticated'
      case 'missing':
      default:
        return 'CLI not installed'
    }
  }, [overallState, repository?.nameWithOwner, userLogin, hasActiveProject])

  const busy = github.isAuthenticating || github.isConnecting

  const closeMenu = useCallback(() => setOpen(false), [])


  const handleConnectProject = useCallback(async () => {
    closeMenu()
    try {
      const info = await github.connectProject()
      pushToast({
        tone: 'success',
        title: 'Repository connected',
        description: `${info.nameWithOwner} • default branch ${info.defaultBranch}`,
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushToast({ tone: 'error', title: 'Failed to connect project', description: message })
    }
  }, [closeMenu, github, pushToast])

  const handleRefreshStatus = useCallback(async () => {
    closeMenu()
    try {
      await github.refreshStatus()
      pushToast({ tone: 'success', title: 'GitHub status refreshed' })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      pushToast({ tone: 'error', title: 'Failed to refresh status', description: message })
    }
  }, [closeMenu, github, pushToast])

  const canConnectProject = installed && authenticated && !repository && hasActiveProject

  return (
    <div className={`relative ${className ?? ''}`} ref={menuRef}>
      <button
        type="button"
        className="flex items-center gap-2 px-2 h-[22px] border rounded-md text-xs"
        style={{
          backgroundColor: theme.colors.background.elevated,
          borderColor: theme.colors.border.subtle,
          color: theme.colors.text.primary,
        }}
        disabled={busy}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="GitHub integration"
      >
        <FaGithub className="text-[12px]" />
        <span className="truncate max-w-[120px]">{statusLabel}</span>
        <span
          aria-hidden="true"
          style={{
            display: 'inline-flex',
            width: 6,
            height: 6,
            borderRadius: '9999px',
            backgroundColor: indicatorColor,
          }}
        />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 mt-2 min-w-[240px] z-30 rounded-lg overflow-hidden"
          style={menuContainerStyle}
        >
          <div className="px-3 py-2 text-xs" style={{ color: theme.colors.text.secondary }}>
            <div className="flex items-center gap-2">
              <FaGithub className="text-[14px]" />
              <span style={{ color: theme.colors.text.primary }}>GitHub CLI</span>
            </div>
            <div className="mt-2 space-y-1">
              <div>Installed: <strong>{installed ? 'Yes' : 'No'}</strong></div>
              <div>Authenticated: <strong>{authenticated ? 'Yes' : 'No'}</strong></div>
              {repository ? (
                <div>
                  Repository: <strong>{repository.nameWithOwner}</strong>
                  <div className="text-[11px]" style={{ color: theme.colors.text.muted }}>
                    Default branch {repository.defaultBranch}
                  </div>
                </div>
              ) : (
                <div>Repository: <strong>Not connected</strong></div>
              )}
              {userLogin && (
                <div>Account: <strong>{userLogin}</strong></div>
              )}
            </div>
            {!installed && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: theme.colors.border.subtle }}>
                <div className="text-[11px]" style={{ color: theme.colors.text.muted }}>
                  Install the GitHub CLI to enable PR automation.
                </div>
              </div>
            )}
            {installed && !authenticated && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: theme.colors.border.subtle }}>
                <div className="text-[11px]" style={{ color: theme.colors.text.muted }}>
                  To authenticate, run <code className="px-1 py-0.5 rounded" style={{ backgroundColor: theme.colors.background.hover }}>gh auth login</code> in your terminal, then refresh status.
                </div>
              </div>
            )}
          </div>

          <div style={dividerStyle} />

          <button
            type="button"
            role="menuitem"
            onClick={handleConnectProject}
            disabled={!canConnectProject || github.isConnecting}
            className="w-full px-3 py-2 text-left text-xs flex items-center gap-2"
            style={{
              color: canConnectProject ? theme.colors.text.primary : theme.colors.text.muted,
              cursor: canConnectProject ? 'pointer' : 'not-allowed',
              opacity: canConnectProject ? 1 : 0.5,
              backgroundColor: 'transparent',
            }}
          >
            <span>Connect active project</span>
          </button>

          {repository && hasActiveProject && (
            <button
              type="button"
              role="menuitem"
              onClick={handleConnectProject}
              disabled={github.isConnecting}
              className="w-full px-3 py-2 text-left text-xs flex items-center gap-2"
              style={{
                color: theme.colors.text.primary,
                cursor: 'pointer',
                backgroundColor: 'transparent',
              }}
            >
              <span>Reconnect project</span>
            </button>
          )}

          <button
            type="button"
            role="menuitem"
            onClick={handleRefreshStatus}
            className="w-full px-3 py-2 text-left text-xs flex items-center gap-2"
            style={{
              color: theme.colors.text.primary,
              backgroundColor: 'transparent',
            }}
          >
            <VscRefresh className="text-[13px]" />
            <span>Refresh status</span>
          </button>
        </div>
      )}
    </div>
  )
}

export default GithubMenuButton
