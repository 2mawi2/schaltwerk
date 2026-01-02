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
                    'bg-accent-red-dim text-accent-red-text border-accent-red-border hover:bg-accent-red focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-red',
                    className
                )}
                aria-label={`Worktree for ${sessionName} has uncommitted changes`}
                title={tooltipText}
            >
                <span className="relative flex items-center">
                    <span className="w-1.5 h-1.5 rounded-full bg-accent-red" />
                </span>
                <span style={{ lineHeight: theme.lineHeight.badge }}>{label}</span>
            </button>
            {showTooltip && (
                <div
                    role="tooltip"
                    className="fixed z-50 px-2 py-1 text-xs rounded shadow-lg pointer-events-none"
                    style={{
                        top: `${tooltipPosition.top}px`,
                        left: `${tooltipPosition.left}px`,
                        transform: 'translateX(-50%)',
                        backgroundColor: 'var(--color-bg-elevated)',
                        color: 'var(--color-text-primary)',
                        border: `1px solid ${'var(--color-border-subtle)'}`,
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
