import { memo, useState } from 'react'
import { VscArrowDown } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { withOpacity } from '../../common/colorUtils'

interface TerminalScrollButtonProps {
    visible: boolean
    onClick: (e: React.MouseEvent) => void
}

export const TerminalScrollButton = memo(({ visible, onClick }: TerminalScrollButtonProps) => {
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
                    ? theme.colors.background.elevated 
                    : withOpacity(theme.colors.background.elevated, 0.6),
                borderColor: theme.colors.border.subtle,
                color: isHovered 
                    ? theme.colors.text.primary 
                    : theme.colors.text.tertiary,
            }}
            title="Scroll to bottom"
            aria-label="Scroll to bottom"
        >
            <VscArrowDown size={16} />
        </button>
    )
})

TerminalScrollButton.displayName = 'TerminalScrollButton'
