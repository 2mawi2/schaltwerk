import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { FaGitlab } from 'react-icons/fa'
import { VscRefresh } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { useGitlabIntegrationContext } from '../../contexts/GitlabIntegrationContext'
import { useToast } from '../../common/toast/ToastProvider'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n'
import { useOutsideDismiss } from '../../hooks/useOutsideDismiss'

interface GitlabMenuButtonProps {
  className?: string
  onConfigureSources?: () => void
}

const menuContainerStyle: CSSProperties = {
  backgroundColor: 'var(--color-bg-elevated)',
  border: '1px solid var(--color-border-subtle)',
  boxShadow: '0 12px 24px rgba(var(--color-bg-primary-rgb), 0.45)',
}

const dividerStyle: CSSProperties = {
  height: 1,
  width: '100%',
  backgroundColor: 'var(--color-border-subtle)',
  opacity: 0.6,
}

type MenuButtonKey = 'configure' | 'refresh'

export function GitlabMenuButton({ className, onConfigureSources }: GitlabMenuButtonProps) {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const gitlab = useGitlabIntegrationContext()
  const [open, setOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement | null>(null)
  useOutsideDismiss(menuRef, () => setOpen(false))
  const [hoveredButton, setHoveredButton] = useState<MenuButtonKey | null>(null)
  const [focusedButton, setFocusedButton] = useState<MenuButtonKey | null>(null)

  const installed = gitlab.status?.installed ?? false
  const authenticated = installed && (gitlab.status?.authenticated ?? false)
  const userLogin = gitlab.status?.userLogin ?? null
  const hostname = gitlab.status?.hostname ?? null

  const overallState: 'missing' | 'unauthenticated' | 'no-sources' | 'connected' = !installed
    ? 'missing'
    : !authenticated
      ? 'unauthenticated'
      : gitlab.hasSources
        ? 'connected'
        : 'no-sources'

  const indicatorColor = useMemo(() => {
    switch (overallState) {
      case 'connected':
        return 'var(--color-accent-green)'
      case 'no-sources':
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
        return t.gitlabMenu.statusLabels.sourcesCount.replace('{count}', String(gitlab.sources.length))
      case 'no-sources':
        return t.gitlabMenu.statusLabels.configureGitlab
      case 'unauthenticated':
        return t.gitlabMenu.statusLabels.notAuthenticated
      case 'missing':
      default:
        return t.gitlabMenu.statusLabels.cliNotInstalled
    }
  }, [overallState, gitlab.sources.length, t.gitlabMenu.statusLabels])

  const closeMenu = useCallback(() => setOpen(false), [])

  const handleRefreshStatus = useCallback(async () => {
    closeMenu()
    try {
      await gitlab.refreshStatus()
      pushToast({ tone: 'success', title: t.gitlabMenu.toasts.statusRefreshed })
    } catch (error) {
      logger.error('Failed to refresh GitLab status', error)
      const message = error instanceof Error ? error.message : String(error)
      pushToast({ tone: 'error', title: t.gitlabMenu.toasts.refreshFailed, description: message })
    }
  }, [closeMenu, gitlab, pushToast, t.gitlabMenu.toasts])

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
        backgroundColor: isHovered ? 'var(--color-bg-active)' : 'var(--color-bg-tertiary)',
        borderColor: (isHovered || isFocused) ? 'var(--color-border-focus)' : 'var(--color-border-default)',
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
        boxShadow: isFocused ? '0 0 0 2px rgba(var(--color-border-focus-rgb), 0.45)' : 'none',
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
        className="flex items-center gap-2 px-2 h-[22px] border rounded-md text-caption"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-text-primary)',
        }}
        disabled={gitlab.loading}
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        title="GitLab integration"
      >
        <FaGitlab className="text-caption" />
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
          <div className="px-3 py-2 text-caption" style={{ color: 'var(--color-text-secondary)' }}>
            <div className="flex items-center gap-2">
              <FaGitlab className="text-body" />
              <span style={{ color: 'var(--color-text-primary)' }}>{t.gitlabMenu.title}</span>
            </div>
            <div className="mt-2 space-y-1">
              <div>{t.gitlabMenu.installed} <strong>{installed ? t.settings.common.yes : t.settings.common.no}</strong></div>
              <div>{t.gitlabMenu.authenticated} <strong>{authenticated ? t.settings.common.yes : t.settings.common.no}</strong></div>
              {hostname && (
                <div>{t.gitlabMenu.hostname} <strong>{hostname}</strong></div>
              )}
              {userLogin && (
                <div>{t.gitlabMenu.account} <strong>{userLogin}</strong></div>
              )}
              <div>{t.gitlabMenu.sources} <strong>{gitlab.sources.length}</strong></div>
            </div>
            {!installed && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <div className="text-caption" style={{ color: 'var(--color-text-muted)' }}>
                  {t.gitlabMenu.installCliHint}
                </div>
              </div>
            )}
            {installed && !authenticated && (
              <div className="mt-3 pt-2 border-t" style={{ borderColor: 'var(--color-border-subtle)' }}>
                <div className="text-caption" style={{ color: 'var(--color-text-muted)' }}>
                  {t.gitlabMenu.authHint}
                </div>
              </div>
            )}
          </div>

          <div style={dividerStyle} />

          <div className="px-3 pb-3 pt-2 space-y-2">
            <button
              type="button"
              role="menuitem"
              onClick={() => { closeMenu(); onConfigureSources?.() }}
              disabled={!installed || !authenticated}
              className="text-left text-caption"
              style={buildMenuButtonStyle('configure', { disabled: !installed || !authenticated })}
              onMouseEnter={() => installed && authenticated && setHoveredButton('configure')}
              onMouseLeave={() => setHoveredButton((prev) => (prev === 'configure' ? null : prev))}
              onFocus={() => installed && authenticated && setFocusedButton('configure')}
              onBlur={() => setFocusedButton((prev) => (prev === 'configure' ? null : prev))}
            >
              <span>{t.gitlabMenu.configureSources}</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => { void handleRefreshStatus() }}
              className="text-left text-caption"
              style={buildMenuButtonStyle('refresh', { withIcon: true })}
              onMouseEnter={() => setHoveredButton('refresh')}
              onMouseLeave={() => setHoveredButton((prev) => (prev === 'refresh' ? null : prev))}
              onFocus={() => setFocusedButton('refresh')}
              onBlur={() => setFocusedButton((prev) => (prev === 'refresh' ? null : prev))}
            >
              <VscRefresh className="text-label" />
              <span>{t.gitlabMenu.refreshStatus}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default GitlabMenuButton
