import { useState, useEffect, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'
import { useTranslation } from '../../common/i18n'

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
    const { t } = useTranslation()
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
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="w-[480px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
                <h2 className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">
                    {t.customAgentModal.title}
                </h2>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm text-slate-300 mb-2">{t.customAgentModal.selectAgent}</label>
                        <ModelSelector
                            value={agentType}
                            onChange={setAgentType}
                            disabled={isSelecting}
                            skipPermissions={skipPermissions}
                            onSkipPermissionsChange={(value) => setSkipPermissions(value)}
                            onDropdownOpenChange={setIsModelSelectorOpen}
                            allowedAgents={ALLOWED_AGENTS}
                        />
                        <p className="text-xs text-slate-400 mt-2">
                            {t.customAgentModal.helperText}
                        </p>
                    </div>
                </div>

                <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={isSelecting}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:opacity-50 rounded group relative"
                        title={t.customAgentModal.cancelEsc}
                    >
                        {t.customAgentModal.cancel}
                        <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
                    </button>
                    <button
                        onClick={() => { void handleSelect() }}
                        disabled={isSelecting}
                        className="px-3 py-1.5 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2"
                        style={{
                            backgroundColor: 'var(--color-accent-blue-dark)',
                        }}
                        onMouseEnter={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--color-accent-blue)'
                        }}
                        onMouseLeave={(e) => {
                            e.currentTarget.style.backgroundColor = 'var(--color-accent-blue-dark)'
                        }}
                        title={t.customAgentModal.addTabEnter}
                    >
                        {isSelecting && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>{t.customAgentModal.addTab}</span>
                        {!isSelecting && (
                            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>
                        )}
                    </button>
                </div>
            </div>
        </div>
    )
}
