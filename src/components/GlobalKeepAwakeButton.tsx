import { useMemo, useState, CSSProperties } from 'react'
import { useAtom, useSetAtom } from 'jotai'
import {
  keepAwakeStateAtom,
  toggleKeepAwakeActionAtom,
  KeepAwakeState,
} from '../store/atoms/powerSettings'
import { logger } from '../utils/logger'
import { useOptionalToast } from '../common/toast/ToastProvider'
import { useTranslation } from '../common/i18n'

const CoffeeIcon = ({ state }: { state: KeepAwakeState }) => {
  const stroke = state === 'disabled' ? 'var(--color-text-tertiary)' : 'var(--color-text-primary)'
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke={stroke} strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8h15a3 3 0 0 1 0 6h-1" />
      <path d="M17 8v5a5 5 0 0 1-5 5H8a5 5 0 0 1-5-5V8" />
      <path d="M6 2h.01" />
      <path d="M10 2h.01" />
      <path d="M14 2h.01" />
    </svg>
  )
}

export function GlobalKeepAwakeButton() {
  const { t } = useTranslation()
  const [state] = useAtom(keepAwakeStateAtom)
  const [isLoading, setIsLoading] = useState(false)
  const [errorTooltip, setErrorTooltip] = useState<string | null>(null)
  const setToggle = useSetAtom(toggleKeepAwakeActionAtom)
  const toast = useOptionalToast()

  const style = useMemo(() => {
    switch (state) {
      case 'active':
        return {
          backgroundColor: 'var(--color-accent-green-bg)',
          borderColor: 'var(--color-accent-green-border)',
          color: 'var(--color-text-primary)',
        }
      case 'auto_paused':
        return {
          backgroundColor: 'var(--color-accent-amber-bg)',
          borderColor: 'var(--color-accent-amber-border)',
          color: 'var(--color-text-primary)',
        }
      case 'disabled':
      default:
        return {
          backgroundColor: 'rgba(var(--color-bg-elevated-rgb), 0.6)',
          borderColor: 'var(--color-border-subtle)',
          color: 'var(--color-text-tertiary)',
        }
    }
  }, [state])

  const tooltip = useMemo(() => {
    if (errorTooltip) {
      return errorTooltip
    }
    if (state === 'disabled') {
      return t.globalKeepAwake.clickToEnable
    }
    if (state === 'auto_paused') {
      return t.globalKeepAwake.autoPaused
    }
    return t.globalKeepAwake.preventingSleep
  }, [state, errorTooltip, t])

  const handleClick = async () => {
    setIsLoading(true)
    try {
      const next = await setToggle()
      setErrorTooltip(null)
      if (toast && next) {
        const title = next === 'disabled' ? t.globalKeepAwake.disabled : t.globalKeepAwake.enabled
        const description = next === 'disabled'
          ? t.globalKeepAwake.canSleepNormally
          : t.globalKeepAwake.willStayAwake
        toast.pushToast({ tone: next === 'disabled' ? 'info' : 'success', title, description })
      }
    } catch (error) {
      logger.error('Failed to toggle keep-awake', error)
      setErrorTooltip(t.globalKeepAwake.unavailable)
      if (toast) {
        toast.pushToast({
          tone: 'error',
          title: t.globalKeepAwake.unavailable,
          description: 'caffeinate/systemd-inhibit failed or missing',
        })
      }
    } finally {
      setIsLoading(false)
    }
  }

  const showDot = state === 'auto_paused'

  return (
    <button
      onClick={() => { void handleClick() }}
      className="h-8 w-8 inline-flex items-center justify-center rounded-md border transition-colors duration-150 shadow-sm"
      style={style as CSSProperties}
      title={tooltip}
      aria-label={t.globalKeepAwake.toggleLabel}
      disabled={isLoading || Boolean(errorTooltip)}
    >
      <div className="relative flex items-center justify-center">
        <CoffeeIcon state={state} />
        {showDot && (
          <span
            className="absolute -top-1 -right-1 block h-2 w-2 rounded-full"
            data-testid="keep-awake-autopause-indicator"
            style={{ backgroundColor: 'var(--color-accent-amber)' }}
          />
        )}
      </div>
    </button>
  )
}
