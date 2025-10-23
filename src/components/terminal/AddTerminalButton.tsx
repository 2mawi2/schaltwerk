import { useState, type MouseEvent } from 'react'
import { VscAdd } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { withOpacity } from '../../common/colorUtils'

interface AddTerminalButtonProps {
  onClick: (event: MouseEvent<HTMLButtonElement>) => void
  title: string
  ariaLabel?: string
  className?: string
}

export function AddTerminalButton({
  onClick,
  title,
  ariaLabel,
  className = ''
}: AddTerminalButtonProps) {
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
        inline-flex items-center justify-center rounded-md
        bg-bg-tertiary text-text-secondary
        transition-[background-color,color] duration-150 ease-out
        focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-border-focus/80
        focus-visible:ring-offset-2 focus-visible:ring-offset-bg-primary
        ${className}
      `}
      style={{
        backgroundColor: isHovered
          ? withOpacity(theme.colors.background.elevated, 0.65)
          : theme.colors.background.tertiary,
        color: isHovered ? theme.colors.text.primary : theme.colors.text.secondary,
      }}
    >
      <VscAdd className="block text-[15px] leading-none" />
    </button>
  )
}
