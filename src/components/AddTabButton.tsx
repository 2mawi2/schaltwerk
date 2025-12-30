import { useState, type MouseEvent } from 'react'
import { VscAdd } from 'react-icons/vsc'
import { theme } from '../common/theme'

interface AddTabButtonProps {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  title: string
  ariaLabel?: string
  className?: string
}

export function AddTabButton({
  onClick,
  title,
  ariaLabel,
  className = ''
}: AddTabButtonProps) {
  const [isHovered, setIsHovered] = useState(false)

  return (
    <button
      type="button"
      onClick={onClick}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onFocus={() => setIsHovered(true)}
      onBlur={() => setIsHovered(false)}
      title={title}
      aria-label={ariaLabel}
      className={`
        flex items-center justify-center rounded
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/80
        focus-visible:ring-offset-1 focus-visible:ring-offset-bg-primary
        ${className}
      `}
      style={{
        width: '24px',
        height: '24px',
        backgroundColor: isHovered
          ? 'var(--color-tab-inactive-hover-bg)'
          : 'transparent',
        color: isHovered
          ? 'var(--color-text-secondary)'
          : 'var(--color-text-muted)',
        transition: 'background-color 150ms ease-out, color 150ms ease-out, transform 100ms ease-out',
        transform: isHovered ? 'scale(1.05)' : 'scale(1)',
      }}
    >
      <VscAdd style={{ fontSize: theme.fontSize.body }} />
    </button>
  )
}
