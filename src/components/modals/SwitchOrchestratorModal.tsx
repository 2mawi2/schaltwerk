import { useState, useEffect, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'
import { logger } from '../../utils/logger'

interface Props {
    open: boolean
    onClose: () => void
    onSwitch: (options: { agentType: AgentType; skipPermissions: boolean }) => void | Promise<void>
}

export function SwitchOrchestratorModal({ open, onClose, onSwitch }: Props) {
    const [agentType, setAgentType] = useState<AgentType>('claude')
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [switching, setSwitching] = useState(false)
    const { getAgentType, getSkipPermissions } = useClaudeSession()
    const switchRef = useRef<() => void>(() => {})
    
    const handleSwitch = async () => {
        if (switching) return
        
        setSwitching(true)
        try {
            await Promise.resolve(onSwitch({ agentType, skipPermissions }))
        } finally {
            setSwitching(false)
        }
    }
    
    switchRef.current = handleSwitch
    
    useEffect(() => {
        if (open) {
            setSwitching(false)
            Promise.all([getAgentType(), getSkipPermissions()])
                .then(([type, skip]) => {
                    const normalized = AGENT_TYPES.includes(type as AgentType) ? (type as AgentType) : 'claude'
                    setAgentType(normalized)
                    const supports = AGENT_SUPPORTS_SKIP_PERMISSIONS[normalized]
                    setSkipPermissions(supports ? Boolean(skip) : false)
                })
                .catch(error => {
                    logger.warn('[SwitchOrchestratorModal] Failed to load agent configuration:', error)
                })
        }
    }, [open, getAgentType, getSkipPermissions])
    
    useEffect(() => {
        if (!open) return
        
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
            } else if (e.key === 'Enter') {
                e.preventDefault()
                switchRef.current()
            }
        }
        
        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open, onClose])
    
    if (!open) return null
    
    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="w-[480px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
                <div className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">
                    Switch Orchestrator Agent
                </div>
                
                <div className="p-4 space-y-4">
                    <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                        <div className="flex items-start gap-2">
                            <span className="text-amber-500 text-lg">⚠️</span>
                            <div className="text-sm text-amber-200">
                                <p className="font-medium mb-1">Warning</p>
                                <p className="text-amber-300/90">
                                    Switching the orchestrator agent will restart the terminal and clear the current session history. 
                                    Any unsaved work in the orchestrator terminal will be lost.
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label className="block text-sm text-slate-300 mb-2">Select Agent</label>
                        <ModelSelector
                            value={agentType}
                            onChange={setAgentType}
                            disabled={switching}
                            skipPermissions={skipPermissions}
                            onSkipPermissionsChange={(value) => setSkipPermissions(value)}
                        />
                        <p className="text-xs text-slate-400 mt-2">
                            Choose the AI agent to use for the orchestrator terminal
                        </p>
                    </div>
                </div>
                
                <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
                    <button
                        onClick={onClose}
                        disabled={switching}
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:bg-slate-800 disabled:opacity-50 rounded group relative"
                        title="Cancel (Esc)"
                    >
                        Cancel
                        <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
                    </button>
                    <button
                        onClick={handleSwitch}
                        disabled={switching}
                        className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2"
                        title="Switch Agent (Enter)"
                    >
                        {switching && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>Switch Agent</span>
                        {!switching && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>}
                    </button>
                </div>
            </div>
        </div>
    )
}
