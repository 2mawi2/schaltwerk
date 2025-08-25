import { useState, useEffect, useRef } from 'react'
import { ModelSelector } from '../inputs/ModelSelector'
import { useClaudeSession } from '../../hooks/useClaudeSession'

interface Props {
    open: boolean
    onClose: () => void
    onSwitch: (agentType: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex') => void | Promise<void>
}

export function SwitchCommanderModal({ open, onClose, onSwitch }: Props) {
    const [agentType, setAgentType] = useState<'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'>('claude')
    const [switching, setSwitching] = useState(false)
    const { getAgentType } = useClaudeSession()
    const switchRef = useRef<() => void>(() => {})
    
    const handleSwitch = async () => {
        if (switching) return
        
        try {
            setSwitching(true)
            await Promise.resolve(onSwitch(agentType))
        } catch (e) {
            setSwitching(false)
            throw e
        }
    }
    
    switchRef.current = handleSwitch
    
    useEffect(() => {
        if (open) {
            setSwitching(false)
            getAgentType().then(type => setAgentType(type as 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'))
        }
    }, [open, getAgentType])
    
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
                    Switch Commander Model
                </div>
                
                <div className="p-4 space-y-4">
                    <div className="p-3 bg-amber-900/20 border border-amber-700/50 rounded-lg">
                        <div className="flex items-start gap-2">
                            <span className="text-amber-500 text-lg">⚠️</span>
                            <div className="text-sm text-amber-200">
                                <p className="font-medium mb-1">Warning</p>
                                <p className="text-amber-300/90">
                                    Switching the commander model will restart the terminal and clear the current session history. 
                                    Any unsaved work in the commander terminal will be lost.
                                </p>
                            </div>
                        </div>
                    </div>
                    
                    <div>
                        <label className="block text-sm text-slate-300 mb-2">Select Model</label>
                        <ModelSelector
                            value={agentType}
                            onChange={setAgentType}
                            disabled={switching}
                        />
                        <p className="text-xs text-slate-400 mt-2">
                            Choose the AI model to use for the commander terminal
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
                        title="Switch Model (Enter)"
                    >
                        {switching && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>Switch Model</span>
                        {!switching && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">↵</span>}
                    </button>
                </div>
            </div>
        </div>
    )
}