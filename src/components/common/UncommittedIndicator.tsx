import { useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { theme } from '../../common/theme'

interface UncommittedIndicatorProps {
    sessionName: string
    samplePaths?: string[]
    className?: string
    label?: string
}

export function UncommittedIndicator({
    sessionName,
    samplePaths,
    className,
    label = 'dirty'
}: UncommittedIndicatorProps) {
    const buttonRef = useRef<HTMLButtonElement>(null)
    const [showTooltip, setShowTooltip] = useState(false)
    const [tooltipPosition, setTooltipPosition] = useState({ top: 0, left: 0 })

    const tooltipText = useMemo(() => {
        if (samplePaths && samplePaths.length > 0) {
            const listed = samplePaths.slice(0, 3).join('\n• ')
            return `Uncommitted changes in ${sessionName} worktree:\n• ${listed}`
        }
        return `Uncommitted changes detected in ${sessionName}. Commit or discard to clear.`
    }, [samplePaths, sessionName])

    const handleMouseEnter = () => {
        const node = buttonRef.current
        if (!node) return
        const rect = node.getBoundingClientRect()
        setTooltipPosition({
            top: rect.top - 32,
            left: rect.left + rect.width / 2,
        })
        setShowTooltip(true)
    }

    const handleMouseLeave = () => {
        setShowTooltip(false)
    }

    return (
        <>
            <button
                ref={buttonRef}
                type="button"
                onMouseEnter={handleMouseEnter}
                onMouseLeave={handleMouseLeave}
                onFocus={handleMouseEnter}
                onBlur={handleMouseLeave}
                onClick={(event) => event.stopPropagation()}
                className={clsx(
                    'inline-flex items-center gap-1 px-1.5 py-0.5 rounded border text-xs transition-colors',
                    'bg-rose-900/30 text-rose-200 border-rose-700/60 hover:bg-rose-800/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-rose-400/60',
                    className
                )}
                aria-label={`Worktree for ${sessionName} has uncommitted changes`}
                title={tooltipText}
            >
                <span className="relative flex items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-rose-400" />
                </span>
                <span className="leading-none">{label}</span>
            </button>
            {showTooltip && (
                <div
                    role="tooltip"
                    className="fixed z-50 px-2 py-1 text-xs rounded shadow-lg pointer-events-none"
                    style={{
                        top: `${tooltipPosition.top}px`,
                        left: `${tooltipPosition.left}px`,
                        transform: 'translateX(-50%)',
                        backgroundColor: theme.colors.background.elevated,
                        color: theme.colors.text.primary,
                        border: `1px solid ${theme.colors.border.subtle}`,
                    }}
                >
                    {tooltipText.split('\n').map((line, index) => (
                        <div key={index}>{line}</div>
                    ))}
                </div>
            )}
        </>
    )
}
