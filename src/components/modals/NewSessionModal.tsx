import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { generateDockerStyleName } from '../../utils/dockerNames'
import { invoke } from '@tauri-apps/api/core'
import { SessionConfigurationPanel } from '../shared/SessionConfigurationPanel'
import { theme } from '../../common/theme'

interface Props {
    open: boolean
    initialIsDraft?: boolean
    onClose: () => void
    onCreate: (data: {
        name: string
        prompt?: string
        baseBranch: string
        userEditedName?: boolean
        isPlan?: boolean
        draftContent?: string
    }) => void | Promise<void>
}

export function NewSessionModal({ open, initialIsDraft = false, onClose, onCreate }: Props) {
    const [name, setName] = useState(() => generateDockerStyleName())
    const [, setWasEdited] = useState(false)
    const [taskContent, setTaskContent] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [agentType, setAgentType] = useState<'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'>('claude')
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [creating, setCreating] = useState(false)
    const [createAsDraft, setCreateAsDraft] = useState(false)
    const [nameLocked, setNameLocked] = useState(false)
    const [repositoryIsEmpty, setRepositoryIsEmpty] = useState(false)
    const [isPrefillPending, setIsPrefillPending] = useState(false)
    const [hasPrefillData, setHasPrefillData] = useState(false)
    const nameInputRef = useRef<HTMLInputElement>(null)
    const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
    const wasEditedRef = useRef(false)
    const createRef = useRef<() => void>(() => {})
    const initialGeneratedNameRef = useRef<string>('')

    const handleBranchChange = (branch: string) => {
        setBaseBranch(branch)
        // Clear validation error when user changes branch
        if (validationError && validationError.includes('Branch')) {
            setValidationError('')
        }
    }

    const handleAgentTypeChange = (type: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex') => {
        setAgentType(type)
    }

    const handleSkipPermissionsChange = (enabled: boolean) => {
        setSkipPermissions(enabled)
    }

    const validateSessionName = useCallback((sessionName: string): string | null => {
        if (!sessionName.trim()) {
            return 'Agent name is required'
        }
        if (sessionName.length > 100) {
            return 'Agent name must be 100 characters or less'
        }
        if (!/^[a-zA-Z0-9_\- ]+$/.test(sessionName)) {
            return 'Agent name can only contain letters, numbers, hyphens, and underscores'
        }
        return null
    }, [])

    const handleNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newName = e.target.value
        setName(newName)
        setWasEdited(true)
        wasEditedRef.current = true
        
        // Clear validation error when user starts typing again
        if (validationError) {
            setValidationError('')
        }
    }

    const handleCreate = useCallback(async () => {
        if (creating) return
        // Read directly from input when available to avoid any stale state in tests
        const currentValue = nameInputRef.current?.value ?? name
        // Generate new name if current value is empty
        let finalName = currentValue.trim() || generateDockerStyleName()
        
        const error = validateSessionName(finalName)
        if (error) {
            setValidationError(error)
            return
        }
        
        // Validate that base branch is selected
        if (!createAsDraft && !baseBranch) {
            setValidationError('Please select a base branch')
            return
        }
        
        // Validate plan content if creating as plan
        if (createAsDraft && !taskContent.trim()) {
            setValidationError('Please enter plan content')
            return
        }
        
        // Replace spaces with underscores for the actual session name
        finalName = finalName.replace(/ /g, '_')
        
        const userEdited = wasEditedRef.current || (
            initialGeneratedNameRef.current && currentValue.trim() !== initialGeneratedNameRef.current
        )

        try {
            setCreating(true)
            
            
            const createData = {
                name: finalName,
                prompt: createAsDraft ? undefined : (taskContent || undefined),
                baseBranch: createAsDraft ? '' : baseBranch,
                // If user touched the input, treat name as manually edited
                userEditedName: !!userEdited,
                isPlan: createAsDraft,
                draftContent: createAsDraft ? taskContent : undefined,
            }
            console.log('[NewSessionModal] Creating session with data:', {
                ...createData,
                createAsDraft,
                taskContent: taskContent ? taskContent.substring(0, 100) + (taskContent.length > 100 ? '...' : '') : undefined,
                promptWillBe: createData.prompt ? createData.prompt.substring(0, 100) + (createData.prompt.length > 100 ? '...' : '') : undefined
            })
            await Promise.resolve(onCreate(createData))
            // On success the parent will close the modal; no need to reset creating here
        } catch (_e) {
            // Parent handles showing the error; re-enable to allow retry
            setCreating(false)
        }
    }, [creating, name, taskContent, baseBranch, onCreate, validateSessionName, createAsDraft])

    // Keep ref in sync immediately on render to avoid stale closures in tests
    createRef.current = handleCreate

    useLayoutEffect(() => {
        if (open) {
            console.log('[NewSessionModal] Modal opened with:', {
                initialIsDraft,
                isPrefillPending,
                hasPrefillData,
                currentCreateAsDraft: createAsDraft
            })
            
            setCreating(false)
            // Generate a fresh Docker-style name each time the modal opens
            const gen = generateDockerStyleName()
            initialGeneratedNameRef.current = gen
            
            // Only reset state if we're not expecting prefill data AND don't already have it
            if (!isPrefillPending && !hasPrefillData) {
                console.log('[NewSessionModal] Resetting modal state - reason: no prefill pending or data')
                setName(gen)
                setWasEdited(false)
                wasEditedRef.current = false
                setTaskContent('')
                setValidationError('')
                setCreateAsDraft(initialIsDraft)
                setNameLocked(false)
            } else {
                console.log('[NewSessionModal] Skipping full state reset - reason: prefill pending or has data')
                // Still need to reset some state
                setValidationError('')
                setCreating(false)
            }
            
            // Check if repository is empty for display purposes
            invoke<boolean>('repository_is_empty')
                .then(setRepositoryIsEmpty)
                .catch(err => {
                    console.warn('Failed to check if repository is empty:', err)
                    setRepositoryIsEmpty(false)
                })
            
            // Focus the prompt textarea when modal opens
            setTimeout(() => {
                promptTextareaRef.current?.focus()
            }, 100)
        } else {
            // Reset ALL state when modal closes to prevent stale state
            console.log('[NewSessionModal] Modal closed - resetting all state')
            setIsPrefillPending(false)
            setHasPrefillData(false)
            setCreateAsDraft(false)
            setNameLocked(false)
            setTaskContent('')
            setName('')
            setValidationError('')
            setCreating(false)
        }
    }, [open, initialIsDraft, isPrefillPending, hasPrefillData])

    // Register prefill event listener immediately, not dependent on open state
    // This ensures we can catch events that are dispatched right when the modal opens
    useEffect(() => {
        const prefillHandler = (event: any) => {
            console.log('[NewSessionModal] Received prefill event with detail:', event?.detail)
            const detail = event?.detail || {}
            const nameFromDraft: string | undefined = detail.name
            const taskContentFromDraft: string | undefined = detail.taskContent
            const lockName: boolean | undefined = detail.lockName
            const fromDraft: boolean | undefined = detail.fromDraft
            const baseBranchFromDraft: string | undefined = detail.baseBranch

            if (nameFromDraft) {
                console.log('[NewSessionModal] Setting name from prefill:', nameFromDraft)
                setName(nameFromDraft)
                // Treat this as user-provided name to avoid regen
                wasEditedRef.current = true
                setWasEdited(true)
                setNameLocked(!!lockName)
            }
            if (typeof taskContentFromDraft === 'string') {
                console.log('[NewSessionModal] Setting agent content from prefill:', taskContentFromDraft.substring(0, 100), '...')
                setTaskContent(taskContentFromDraft)
            }
            if (baseBranchFromDraft) {
                console.log('[NewSessionModal] Setting base branch from prefill:', baseBranchFromDraft)
                setBaseBranch(baseBranchFromDraft)
            }
            // If running from an existing plan, don't create another plan
            if (fromDraft) {
                console.log('[NewSessionModal] Running from existing plan - forcing createAsDraft to false')
                setCreateAsDraft(false)
            }
            
            // Clear the prefill pending flag and mark that we have data
            setIsPrefillPending(false)
            setHasPrefillData(true)
            console.log('[NewSessionModal] Prefill data processed, hasPrefillData set to true')
        }
        
        // Listen for a notification that prefill is coming
        const prefillPendingHandler = () => {
            console.log('[NewSessionModal] Prefill pending notification received')
            setIsPrefillPending(true)
        }
        
        window.addEventListener('schaltwerk:new-session:prefill' as any, prefillHandler)
        window.addEventListener('schaltwerk:new-session:prefill-pending' as any, prefillPendingHandler)
        return () => {
            window.removeEventListener('schaltwerk:new-session:prefill' as any, prefillHandler)
            window.removeEventListener('schaltwerk:new-session:prefill-pending' as any, prefillPendingHandler)
        }
    }, [])

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                // Prevent other listeners (e.g., terminals, editors) from seeing ESC while modal is open
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }
                onClose()
            } else if (e.key === 'Enter' && e.metaKey) {
                // Prioritize Cmd+Enter for this modal even if other views are visible
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }
                // Use ref to ensure latest state is used when creating
                createRef.current()
            }
        }

        // Use capture phase so this handler runs before others and can stop propagation
        window.addEventListener('keydown', handleKeyDown, true)
        const setDraftHandler = () => {
            console.log('[NewSessionModal] Received set-plan event - setting createAsDraft to true')
            setCreateAsDraft(true)
        }
        window.addEventListener('schaltwerk:new-session:set-plan' as any, setDraftHandler)
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true)
            window.removeEventListener('schaltwerk:new-session:set-plan' as any, setDraftHandler)
        }
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: theme.colors.overlay.backdrop }}>
            <div className="w-[720px] max-w-[95vw] rounded-xl shadow-xl" style={{ backgroundColor: theme.colors.background.tertiary, borderColor: theme.colors.border.subtle, border: '1px solid' }}>
                <div className="px-4 py-3 border-b font-medium" style={{ borderBottomColor: theme.colors.border.default, color: theme.colors.text.primary }}>{createAsDraft ? "Create new plan" : "Start new agent"}</div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Agent name</label>
                        <input 
                            ref={nameInputRef}
                            value={name} 
                            onChange={handleNameChange} 
                            onFocus={() => { setWasEdited(true); wasEditedRef.current = true }}
                            onKeyDown={() => { setWasEdited(true); wasEditedRef.current = true }}
                            onInput={() => { setWasEdited(true); wasEditedRef.current = true }}
                            className={`w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border ${
                                validationError ? 'border-red-500' : 'border-slate-700'
                            }`} 
                            placeholder="eager_cosmos" 
                            disabled={nameLocked}
                        />
                        {validationError && (
                            <div className="flex items-start gap-2 mt-1">
                                <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-xs text-red-400">{validationError}</p>
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                        <input 
                            id="createAsDraft" 
                            type="checkbox" 
                            checked={createAsDraft} 
                            onChange={e => setCreateAsDraft(e.target.checked)} 
                            className="text-blue-600"
                        />
                        <label htmlFor="createAsDraft" className="text-sm text-slate-300">Create as plan (no agent will start)</label>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-300 mb-1">
                            {createAsDraft ? 'Plan content' : 'Initial prompt (optional)'}
                        </label>
                        <textarea 
                            ref={promptTextareaRef}
                            value={taskContent} 
                            onChange={e => {
                                setTaskContent(e.target.value)
                                // Clear validation error when user starts typing
                                if (validationError) {
                                    setValidationError('')
                                }
                            }} 
                            className="w-full h-32 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 font-mono text-sm" 
                            placeholder={createAsDraft ? "Enter plan content in markdown..." : "Describe the agent for the Claude session"} 
                        />
                        <p className="text-xs text-slate-400 mt-1">
                            {createAsDraft ? (
                                <>
                                    <svg className="inline-block w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    Plan agents are saved for later. You can start them when ready.
                                </>
                            ) : (
                                <>Equivalent to: schaltwerk start &lt;name&gt; -p "&lt;prompt&gt;"</>
                            )}
                        </p>
                    </div>

                    {repositoryIsEmpty && !createAsDraft && (
                        <div className="bg-amber-900/30 border border-amber-700/50 rounded-lg p-3 flex items-start gap-2">
                            <svg className="w-5 h-5 text-amber-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="text-sm text-amber-200">
                                <p className="font-medium mb-1">New repository detected</p>
                                <p className="text-xs text-amber-300">
                                    This repository has no commits yet. An initial commit will be created automatically when you start the agent.
                                </p>
                            </div>
                        </div>
                    )}

                    {!createAsDraft && (
                        <SessionConfigurationPanel
                            variant="modal"
                            onBaseBranchChange={handleBranchChange}
                            onAgentTypeChange={handleAgentTypeChange}
                            onSkipPermissionsChange={handleSkipPermissionsChange}
                            initialBaseBranch={baseBranch}
                            initialAgentType={agentType}
                            initialSkipPermissions={skipPermissions}
                        />
                    )}
                </div>
                <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
                    <button 
                        onClick={onClose} 
                        className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded group relative"
                        title="Cancel (Esc)"
                    >
                        Cancel
                        <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
                    </button>
                    <button 
                        onClick={handleCreate} 
                        disabled={!name.trim() || (!createAsDraft && !baseBranch) || creating || (createAsDraft && !taskContent.trim())}
                        className={`px-3 py-1.5 ${createAsDraft ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'} disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2`}
                        title={createAsDraft ? "Create plan (Cmd+Enter)" : "Start agent (Cmd+Enter)"}
                    >
                        {creating && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>{createAsDraft ? "Create Plan" : "Start Agent"}</span>
                        {!creating && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">⌘↵</span>}
                    </button>
                </div>
            </div>
        </div>
    )
}