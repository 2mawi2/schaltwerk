import { useState, useCallback, useLayoutEffect, useEffect, useRef, useMemo } from 'react'
import { createPortal } from 'react-dom'
import { theme } from '../../common/theme'
import { AgentType, AGENT_TYPES } from '../../types/session'
import { Dropdown } from '../inputs/Dropdown'
import { calculateDropdownGeometry, type DropdownGeometry } from '../inputs/dropdownGeometry'
import { displayNameForAgent } from '../shared/agentDefaults'

export const MAX_VERSION_COUNT = 4
export const MULTI_AGENT_TYPES = AGENT_TYPES.filter(agent => agent !== 'terminal') as AgentType[]
export const VERSION_DROPDOWN_ITEMS = [
    ...Array.from({ length: MAX_VERSION_COUNT }, (_value, index) => {
        const count = index + 1
        return {
            key: String(count),
            label: `${count} ${count === 1 ? 'version' : 'versions'}`,
        }
    }),
    { key: 'multi', label: 'Use Multiple Agents' },
]

export type MultiAgentAllocations = Partial<Record<AgentType, number>>

export const sumAllocations = (allocations: MultiAgentAllocations, excludeAgent?: AgentType) =>
    MULTI_AGENT_TYPES.reduce((sum, agent) => {
        if (excludeAgent && agent === excludeAgent) {
            return sum
        }
        return sum + (allocations[agent] ?? 0)
    }, 0)

export const normalizeAllocations = (
    allocations: MultiAgentAllocations,
    maxCount: number = MAX_VERSION_COUNT
): AgentType[] => {
    const result: AgentType[] = []
    for (const agent of MULTI_AGENT_TYPES) {
        const count = allocations[agent] ?? 0
        for (let i = 0; i < count; i += 1) {
            if (result.length >= maxCount) {
                return result
            }
            result.push(agent)
        }
    }
    return result
}

interface MultiAgentAllocationDropdownProps {
    allocations: MultiAgentAllocations
    selectableAgents: AgentType[]
    totalCount: number
    maxCount: number
    summaryLabel: string
    isAgentAvailable: (agent: AgentType) => boolean
    onToggleAgent: (agent: AgentType, enabled: boolean) => void
    onChangeCount: (agent: AgentType, count: number) => void
}

export function MultiAgentAllocationDropdown({
    allocations,
    selectableAgents,
    totalCount,
    maxCount,
    summaryLabel,
    isAgentAvailable,
    onToggleAgent,
    onChangeCount,
}: MultiAgentAllocationDropdownProps) {
    const [open, setOpen] = useState(false)
    const buttonRef = useRef<HTMLButtonElement>(null)
    const [menuGeometry, setMenuGeometry] = useState<DropdownGeometry | null>(null)

    const updateGeometry = useCallback(() => {
        const button = buttonRef.current
        if (!button) {
            return
        }
        const anchorRect = button.getBoundingClientRect()
        setMenuGeometry(
            calculateDropdownGeometry({
                anchorRect,
                viewport: { width: window.innerWidth, height: window.innerHeight },
                alignment: 'left',
                minWidth: 280,
                minimumViewportHeight: 200,
                verticalOffset: 6,
            })
        )
    }, [])

    useLayoutEffect(() => {
        if (!open) {
            setMenuGeometry(null)
            return
        }
        updateGeometry()
        const handleResize = () => updateGeometry()
        window.addEventListener('resize', handleResize)
        window.addEventListener('scroll', handleResize, true)
        return () => {
            window.removeEventListener('resize', handleResize)
            window.removeEventListener('scroll', handleResize, true)
        }
    }, [open, updateGeometry])

    useEffect(() => {
        if (!open) {
            return
        }
        const handleKey = (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                setOpen(false)
            }
        }
        window.addEventListener('keydown', handleKey, true)
        return () => window.removeEventListener('keydown', handleKey, true)
    }, [open])

    const renderMenu = useCallback(() => {
        if (!open || !menuGeometry) {
            return null
        }
        const positioningStyles =
            menuGeometry.placement === 'above'
                ? { bottom: menuGeometry.bottom }
                : { top: menuGeometry.top }

        return createPortal(
            <>
                <div
                    className="fixed inset-0"
                    style={{ zIndex: theme.layers.dropdownOverlay }}
                    onClick={() => setOpen(false)}
                />
                <div
                    data-testid="multi-agent-config-menu"
                    className="rounded shadow-lg flex flex-col"
                    style={{
                        position: 'fixed',
                        ...positioningStyles,
                        left: menuGeometry.left,
                        width: Math.max(260, menuGeometry.width),
                        maxHeight: Math.max(220, menuGeometry.maxHeight),
                        zIndex: theme.layers.dropdownMenu,
                        backgroundColor: theme.colors.background.elevated,
                        border: `1px solid ${theme.colors.border.default}`,
                    }}
                >
                    <div
                        className="flex items-center justify-between px-3 py-2 border-b"
                        style={{ borderColor: theme.colors.border.subtle }}
                    >
                        <span
                            className="text-xs font-medium uppercase tracking-wide"
                            style={{ color: theme.colors.text.secondary }}
                        >
                            Multi-agent setup
                        </span>
                        <span className="text-xs" style={{ color: theme.colors.text.secondary }}>
                            {totalCount}/{maxCount}
                        </span>
                    </div>
                    <div className="flex flex-col gap-2 px-3 py-2" style={{ overflowY: 'auto' }}>
                        {selectableAgents.map(agent => {
                            const count = allocations[agent] ?? 0
                            const checked = count > 0
                            const checkboxId = `multi-agent-${agent}`
                            const unavailable = !isAgentAvailable(agent)
                            const reachedMax = totalCount >= maxCount
                            const disableNewSelection = !checked && (unavailable || reachedMax)
                            const textColor = disableNewSelection && !checked
                                ? theme.colors.text.secondary
                                : theme.colors.text.primary
                            return (
                                <div key={agent} className="flex items-center justify-between gap-3">
                                    <label
                                        htmlFor={checkboxId}
                                        className="flex items-center gap-2 text-sm"
                                        style={{ color: textColor }}
                                    >
                                        <input
                                            id={checkboxId}
                                            type="checkbox"
                                            checked={checked}
                                            disabled={disableNewSelection && !checked}
                                            onChange={event => onToggleAgent(agent, event.target.checked)}
                                            style={{ accentColor: theme.colors.accent.blue.DEFAULT }}
                                        />
                                        <span>{displayNameForAgent(agent)}</span>
                                    </label>
                                    {checked && (
                                        <AgentCountSelector
                                            agent={agent}
                                            count={count}
                                            maxCount={Math.max(1, maxCount - (totalCount - count))}
                                            onChange={value => onChangeCount(agent, value)}
                                        />
                                    )}
                                </div>
                            )
                        })}
                    </div>
                </div>
            </>,
            document.body
        )
    }, [allocations, isAgentAvailable, maxCount, menuGeometry, onChangeCount, onToggleAgent, open, selectableAgents, totalCount])

    return (
        <>
            <button
                type="button"
                ref={buttonRef}
                data-testid="multi-agent-config-button"
                onClick={() => setOpen(prev => !prev)}
                className="px-2 h-9 rounded inline-flex items-center gap-2 hover:opacity-90"
                style={{
                    backgroundColor: open ? theme.colors.background.hover : theme.colors.background.elevated,
                    color: theme.colors.text.primary,
                    border: `1px solid ${open ? theme.colors.border.default : theme.colors.border.subtle}`,
                }}
                title={summaryLabel}
            >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" aria-hidden="true">
                    <path
                        d="M4 7h16M6 12h12M8 17h8"
                        stroke={theme.colors.text.primary}
                        strokeWidth={1.6}
                        strokeLinecap="round"
                    />
                </svg>
                <span style={{ lineHeight: 1 }}>Configure agents</span>
                <svg
                    width="12"
                    height="12"
                    viewBox="0 0 20 20"
                    fill="currentColor"
                    aria-hidden="true"
                    style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}
                >
                    <path
                        fillRule="evenodd"
                        d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                        clipRule="evenodd"
                    />
                </svg>
            </button>
            {renderMenu()}
        </>
    )
}

interface AgentCountSelectorProps {
    agent: AgentType
    count: number
    maxCount: number
    onChange: (count: number) => void
}

function AgentCountSelector({ agent, count, maxCount, onChange }: AgentCountSelectorProps) {
    const [open, setOpen] = useState(false)
    const safeMax = Math.max(1, maxCount)
    const normalizedCount = Math.min(count, safeMax)
    const items = useMemo(
        () =>
            Array.from({ length: safeMax }, (_value, index) => {
                const value = index + 1
                return { key: String(value), label: `${value}x` }
            }),
        [safeMax]
    )

    return (
        <Dropdown
            open={open}
            onOpenChange={setOpen}
            items={items}
            selectedKey={String(normalizedCount)}
            onSelect={key => {
                const parsed = parseInt(key, 10)
                if (!Number.isNaN(parsed)) {
                    onChange(Math.min(parsed, safeMax))
                }
            }}
            align="left"
            menuTestId={`agent-count-menu-${agent}`}
        >
            {({ open: dropdownOpen, toggle }) => (
                <button
                    type="button"
                    data-testid={`agent-count-${agent}`}
                    onClick={toggle}
                    className="px-2 h-8 rounded inline-flex items-center gap-1 text-sm hover:opacity-90"
                    style={{
                        backgroundColor: dropdownOpen ? theme.colors.background.hover : theme.colors.background.primary,
                        color: theme.colors.text.primary,
                        border: `1px solid ${dropdownOpen ? theme.colors.border.default : theme.colors.border.subtle}`,
                    }}
                >
                    <span>{normalizedCount}x</span>
                    <svg
                        width="10"
                        height="10"
                        viewBox="0 0 20 20"
                        fill="currentColor"
                        aria-hidden="true"
                        style={{ transform: dropdownOpen ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}
                    >
                        <path
                            fillRule="evenodd"
                            d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z"
                            clipRule="evenodd"
                        />
                    </svg>
                </button>
            )}
        </Dropdown>
    )
}
