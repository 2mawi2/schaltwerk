import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FaGithub } from 'react-icons/fa'
import { VscRefresh } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useToast } from '../../common/toast/ToastProvider'
import { withOpacity } from '../../common/colorUtils'
import { logger } from '../../utils/logger'

interface GithubMenuButtonProps {
  className?: string
  hasActiveProject?: boolean
}

const menuContainerStyle: CSSProperties = {
  backgroundColor: 'var(--color-bg-elevated)',
  border: `1px solid ${'var(--color-border-subtle)'}`,
  boxShadow: `0 12px 24px ${withOpacity('var(--color-bg-primary)', 0.45)}`,
}

const dividerStyle: CSSProperties = {
  height: 1,
  width: '100%',
  backgroundColor: 'var(--color-border-subtle)',
  opacity: 0.6,
}

type MenuButtonKey = 'connect' | 'reconnect' | 'refresh'

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
  const [hoveredButton, setHoveredButton] = useState<MenuButtonKey | null>(null)
  const [focusedButton, setFocusedButton] = useState<MenuButtonKey | null>(null)

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
        return 'var(--color-accent-green)'
      case 'disconnected':
        return 'var(--color-accent-blue)'
      case 'unauthenticated':
        return 'var(--color-accent-amber)'
      case 'missing':
      default:
        return 'var(--color-accent-red)'
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
      logger.error('Failed to connect GitHub project', error)
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
      logger.error('Failed to refresh GitHub status', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({ tone: 'error', title: 'Failed to refresh status', description: message })
    }
  }, [closeMenu, github, pushToast])

  const canConnectProject = installed && authenticated && !repository && hasActiveProject
  const connectDisabled = !canConnectProject || github.isConnecting

  const buildMenuButtonStyle = useCallback(
    (
      key: MenuButtonKey,
      {
        disabled = false,
        withIcon = false,
      }: {
        disabled?: boolean
        withIcon?: boolean
      } = {}
    ): CSSProperties => {
      const isHovered = hoveredButton === key && !disabled
      const isFocused = focusedButton === key && !disabled
      return {
        backgroundColor: isHovered ? 'var(--color-bg-hover)' : 'var(--color-bg-secondary)',
        borderColor: (isHovered || isFocused) ? 'var(--color-border-focus)' : 'var(--color-border-subtle)',
        color: disabled ? 'var(--color-text-muted)' : 'var(--color-text-primary)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        fontSize: theme.fontSize.button,
        fontWeight: 500,
        borderRadius: 10,
        borderWidth: 1,
        borderStyle: 'solid',
        width: '100%',
        padding: withIcon ? '10px 14px' : '10px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        transition: 'background-color 120ms ease, border-color 120ms ease, color 120ms ease',
        boxShadow: isFocused ? `0 0 0 2px ${withOpacity('var(--color-border-focus)', 0.45)}` : 'none',
      }
    },
    [focusedButton, hoveredButton]
  )

  useEffect(() => {
    if (!open) {
      setHoveredButton(null)
      setFocusedButton(null)
    }
  }, [open])

  return (
    <div className={`relative ${className ?? ''}`} ref={menuRef}>
      <button
        type="button"
        className="flex items-center gap-2 px-2 h-[22px] border rounded-md text-xs"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-text-primary)',
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
          <div className="px-3 py-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
            <div className="flex items-center gap-2">
              <FaGithub className="text-[14px]" />
              <span style={{ color: 'var(--color-text-primary)' }}>GitHub CLI</span>
            </div>
            <div className="mt-2 space-y-1">
              <div>Installed: <strong>{installed ? 'Yes' : 'No'}</strong></div>
              <div>Authenticated: <strong>{authenticated ? 'Yes' : 'No'}</strong></div>
              {repository ? (
                <div>
                  Repository: <strong>{repository.nameWithOwner}</strong>
                  <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
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
              <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  Install the GitHub CLI to enable PR automation.
                </div>
              </div>
            )}
            {installed && !authenticated && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <div className="text-[11px]" style={{ color: 'var(--color-text-muted)' }}>
                  To authenticate, run <code className="px-1 py-0.5 rounded" style={{ backgroundColor: 'var(--color-bg-hover)' }}>gh auth login</code> in your terminal, then refresh status.
                </div>
              </div>
            )}
          </div>

          <div style={dividerStyle} />

          <div className="px-3 pb-3 pt-2 space-y-2">
            <button
              type="button"
              role="menuitem"
              onClick={() => { void handleConnectProject() }}
              disabled={connectDisabled}
              className="text-left text-xs"
              style={buildMenuButtonStyle('connect', { disabled: connectDisabled })}
              onMouseEnter={() => !connectDisabled && setHoveredButton('connect')}
              onMouseLeave={() => setHoveredButton((prev) => (prev === 'connect' ? null : prev))}
              onFocus={() => !connectDisabled && setFocusedButton('connect')}
              onBlur={() => setFocusedButton((prev) => (prev === 'connect' ? null : prev))}
            >
              <span>Connect active project</span>
            </button>

            {repository && hasActiveProject && (
              <button
                type="button"
                role="menuitem"
                onClick={() => { void handleConnectProject() }}
                disabled={github.isConnecting}
                className="text-left text-xs"
                style={buildMenuButtonStyle('reconnect', { disabled: github.isConnecting })}
                onMouseEnter={() => !github.isConnecting && setHoveredButton('reconnect')}
                onMouseLeave={() => setHoveredButton((prev) => (prev === 'reconnect' ? null : prev))}
                onFocus={() => !github.isConnecting && setFocusedButton('reconnect')}
                onBlur={() => setFocusedButton((prev) => (prev === 'reconnect' ? null : prev))}
              >
                <span>Reconnect project</span>
              </button>
            )}

            <button
              type="button"
              role="menuitem"
              onClick={() => { void handleRefreshStatus() }}
              className="text-left text-xs"
              style={buildMenuButtonStyle('refresh', { withIcon: true })}
              onMouseEnter={() => setHoveredButton('refresh')}
              onMouseLeave={() => setHoveredButton((prev) => (prev === 'refresh' ? null : prev))}
              onFocus={() => setFocusedButton('refresh')}
              onBlur={() => setFocusedButton((prev) => (prev === 'refresh' ? null : prev))}
            >
              <VscRefresh className="text-[13px]" />
              <span>Refresh status</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default GithubMenuButton
