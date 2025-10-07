import { theme } from '../theme'
import './toastAnimations.css'

interface ToastCardProps {
  tone: 'success' | 'warning' | 'error' | 'info'
  title: string
  description?: string
  action?: {
    label: string
    onClick: () => void
  }
  onDismiss: () => void
}

const ToastIcon = ({ tone }: { tone: ToastCardProps['tone'] }) => {
  const iconColor = (() => {
    switch (tone) {
      case 'success':
        return theme.colors.accent.green.DEFAULT
      case 'warning':
        return theme.colors.accent.yellow.DEFAULT
      case 'info':
        return theme.colors.accent.blue.DEFAULT
      case 'error':
      default:
        return theme.colors.accent.red.DEFAULT
    }
  })()

  const iconPath = (() => {
    switch (tone) {
      case 'success':
        return 'M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z'
      case 'warning':
        return 'M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z'
      case 'info':
        return 'M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z'
      case 'error':
      default:
        return 'M10 14l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2m7-2a9 9 0 11-18 0 9 9 0 0118 0z'
    }
  })()

  return (
    <svg
      className="flex-shrink-0"
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke={iconColor}
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d={iconPath} />
    </svg>
  )
}

export function ToastCard({ tone, title, description, action, onDismiss }: ToastCardProps) {
  const accentColor = (() => {
    switch (tone) {
      case 'success':
        return theme.colors.accent.green.DEFAULT
      case 'warning':
        return theme.colors.accent.yellow.DEFAULT
      case 'info':
        return theme.colors.accent.blue.DEFAULT
      case 'error':
      default:
        return theme.colors.accent.red.DEFAULT
    }
  })()

  return (
    <div
      className="toast-enter pointer-events-auto overflow-hidden rounded-lg transition-all duration-300"
      style={{
        backgroundColor: theme.colors.background.elevated,
        border: `1px solid ${theme.colors.border.subtle}`,
        borderLeftWidth: '4px',
        borderLeftColor: accentColor,
        boxShadow: theme.shadow.lg,
      }}
    >
      <div
        className="flex items-start gap-3 px-4 py-3"
        style={{ color: theme.colors.text.primary }}
      >
        <ToastIcon tone={tone} />

        <div className="flex-1 min-w-0">
          <div
            className="font-semibold leading-tight"
            style={{ fontSize: theme.fontSize.body }}
          >
            {title}
          </div>
          {description && (
            <div
              className="mt-1 leading-snug"
              style={{
                fontSize: theme.fontSize.caption,
                color: theme.colors.text.secondary,
              }}
            >
              {description}
            </div>
          )}
          {action && (
            <button
              type="button"
              onClick={action.onClick}
              className="mt-2 inline-flex items-center gap-1 rounded px-3 py-1.5 font-medium transition-all duration-150 hover:brightness-110"
              style={{
                backgroundColor: accentColor,
                color: theme.colors.background.primary,
                fontSize: theme.fontSize.button,
              }}
            >
              {action.label}
            </button>
          )}
        </div>

        <button
          type="button"
          aria-label="Dismiss notification"
          onClick={onDismiss}
          className="flex-shrink-0 rounded p-1 transition-colors duration-150 hover:brightness-125"
          style={{
            color: theme.colors.text.tertiary,
          }}
        >
          <svg
            width="16"
            height="16"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  )
}
