import { memo, useState } from 'react'
import { VscArrowDown } from 'react-icons/vsc'
import { useTranslation } from '../../common/i18n'

interface TerminalScrollButtonProps {
    visible: boolean
    onClick: (e: React.MouseEvent) => void
}

export const TerminalScrollButton = memo(({ visible, onClick }: TerminalScrollButtonProps) => {
    const { t } = useTranslation()
    const [isHovered, setIsHovered] = useState(false)

    return (
        <button
            onClick={onClick}
            onMouseEnter={() => setIsHovered(true)}
            onMouseLeave={() => setIsHovered(false)}
            onFocus={() => setIsHovered(true)}
            onBlur={() => setIsHovered(false)}
            className={`
                absolute bottom-4 right-6 z-20
                h-8 w-8 rounded-md
                flex items-center justify-center
                transition-all duration-150 ease-out
                border shadow-sm
                ${visible ? 'opacity-100 translate-y-0' : 'opacity-0 translate-y-2 pointer-events-none'}
            `}
            style={{
                backgroundColor: isHovered
                    ? 'var(--color-bg-elevated)'
                    : 'rgba(var(--color-bg-elevated-rgb), 0.6)',
                borderColor: 'var(--color-border-subtle)',
                color: isHovered
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-tertiary)',
            }}
            title={t.terminalComponents.scrollToBottom}
            aria-label={t.terminalComponents.scrollToBottom}
        >
            <VscArrowDown size={16} />
        </button>
    )
})

TerminalScrollButton.displayName = 'TerminalScrollButton'
