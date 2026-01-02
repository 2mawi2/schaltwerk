import { useState, useEffect, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'

interface Props {
    open: boolean
    onClose: () => void
    onSelect: (options: { agentType: AgentType; skipPermissions: boolean }) => void | Promise<void>
    initialAgentType?: AgentType
    initialSkipPermissions?: boolean
}

const ALLOWED_AGENTS: AgentType[] = AGENT_TYPES.filter(
    (agent): agent is AgentType => agent !== 'terminal'
)
const DEFAULT_AGENT: AgentType = 'claude'

export function CustomAgentModal({
    open,
    onClose,
    onSelect,
    initialAgentType,
    initialSkipPermissions,
}: Props) {
    const [agentType, setAgentType] = useState<AgentType>(DEFAULT_AGENT)
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [isSelecting, setIsSelecting] = useState(false)
    const [isModelSelectorOpen, setIsModelSelectorOpen] = useState(false)
    const selectRef = useRef<() => void>(() => {})

    const handleSelect = async () => {
        if (isSelecting) return

        setIsSelecting(true)
        try {
            await Promise.resolve(onSelect({ agentType, skipPermissions }))
            onClose()
        } finally {
            setIsSelecting(false)
        }
    }

    selectRef.current = () => { void handleSelect() }

    useEffect(() => {
        if (!open) return

        setIsSelecting(false)

        if (initialAgentType !== undefined) {
            const normalized = AGENT_TYPES.includes(initialAgentType) ? initialAgentType : DEFAULT_AGENT
            const fallbackAgent = ALLOWED_AGENTS[0] ?? DEFAULT_AGENT
            const sanitized = ALLOWED_AGENTS.includes(normalized) ? normalized : fallbackAgent
            setAgentType(sanitized)
            const supports = AGENT_SUPPORTS_SKIP_PERMISSIONS[sanitized]
            setSkipPermissions(supports ? Boolean(initialSkipPermissions) : false)
        } else {
            setAgentType(DEFAULT_AGENT)
            setSkipPermissions(false)
        }
    }, [open, initialAgentType, initialSkipPermissions])

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (isModelSelectorOpen) {
                return
            }

            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                onClose()
            } else if (e.key === 'Enter') {
                e.preventDefault()
                e.stopPropagation()
                selectRef.current()
            }
        }

        window.addEventListener('keydown', handleKeyDown, true)
        return () => window.removeEventListener('keydown', handleKeyDown, true)
    }, [open, onClose, isModelSelectorOpen])

    if (!open) return null

    return (
        <div className="fixed inset-0 bg-overlay-backdrop z-50 flex items-center justify-center">
            <div className="w-[480px] max-w-[95vw] bg-elevated border border-subtle rounded-xl shadow-xl">
                <h2 className="px-4 py-3 border-b border-subtle text-primary font-medium">
                    Add Custom Agent Tab
                </h2>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm text-secondary mb-2">Select Agent</label>
                        <ModelSelector
                            value={agentType}
                            onChange={setAgentType}
                            disabled={isSelecting}
                            skipPermissions={skipPermissions}
                            onSkipPermissionsChange={(value) => setSkipPermissions(value)}
                            onDropdownOpenChange={setIsModelSelectorOpen}
                            allowedAgents={ALLOWED_AGENTS}
                        />
                        <p className="text-xs text-tertiary mt-2">
                            Choose an AI agent to open in a new tab
                        </p>
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-subtle flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={isSelecting}
                        className="px-3 py-1.5 bg-secondary hover:bg-hover disabled:bg-secondary disabled:opacity-50 rounded group relative"
                        title="Cancel (Esc)"
                    >
                        Cancel
                        <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
                    </button>
                    <button
                        onClick={() => { void handleSelect() }}
                        disabled={isSelecting}
                        className="px-3 py-1.5 disabled:bg-hover disabled:cursor-not-allowed disabled:opacity-50 rounded text-inverse group relative inline-flex items-center gap-2"
                        style={{
                            backgroundColor: 'var(--color-accent-blue-dark)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--color-accent-blue)'
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--color-accent-blue-dark)'
                        }}
                        title="Add Tab (Enter)"
                    >
                        {isSelecting && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>Add Tab</span>
                        {!isSelecting && (
                            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
