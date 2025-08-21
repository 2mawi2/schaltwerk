import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { generateDockerStyleName } from '../../utils/dockerNames'
import { invoke } from '@tauri-apps/api/core'
import { BranchAutocomplete } from '../inputs/BranchAutocomplete'
import { ModelSelector } from '../inputs/ModelSelector'

interface Props {
    open: boolean
    initialIsDraft?: boolean
    onClose: () => void
    onCreate: (data: {
        name: string
        prompt?: string
        baseBranch: string
        userEditedName?: boolean
        isDraft?: boolean
        draftContent?: string
    }) => void | Promise<void>
}

export function NewSessionModal({ open, initialIsDraft = false, onClose, onCreate }: Props) {
    const [name, setName] = useState(() => generateDockerStyleName())
    const [, setWasEdited] = useState(false)
    const [taskContent, setTaskContent] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [branches, setBranches] = useState<string[]>([])
    const [loadingBranches, setLoadingBranches] = useState(false)
    const [isValidBranch, setIsValidBranch] = useState(true)
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [agentType, setAgentType] = useState<'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'>('claude')
    const [validationError, setValidationError] = useState('')
    const [creating, setCreating] = useState(false)
    const [createAsDraft, setCreateAsDraft] = useState(false)
    const [nameLocked, setNameLocked] = useState(false)
    const [repositoryIsEmpty, setRepositoryIsEmpty] = useState(false)
    const { getSkipPermissions, setSkipPermissions: saveSkipPermissions, getAgentType, setAgentType: saveAgentType } = useClaudeSession()
    const nameInputRef = useRef<HTMLInputElement>(null)
    const promptTextareaRef = useRef<HTMLTextAreaElement>(null)
    const wasEditedRef = useRef(false)
    const createRef = useRef<() => void>(() => {})
    const initialGeneratedNameRef = useRef<string>('')

    const handleSkipPermissionsChange = async (checked: boolean) => {
        setSkipPermissions(checked)
        await saveSkipPermissions(checked)
    }

    const handleAgentTypeChange = async (type: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex') => {
        setAgentType(type)
        await saveAgentType(type)
    }

    const validateSessionName = useCallback((sessionName: string): string | null => {
        if (!sessionName.trim()) {
            return 'Task name is required'
        }
        if (sessionName.length > 100) {
            return 'Task name must be 100 characters or less'
        }
        if (!/^[a-zA-Z0-9_\- ]+$/.test(sessionName)) {
            return 'Task name can only contain letters, numbers, hyphens, and underscores'
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
        
        // Validate that base branch is selected and exists
        if (!baseBranch) {
            setValidationError('Please select a base branch')
            return
        }
        
        // Check if the branch exists in the repository
        if (!branches.includes(baseBranch)) {
            setValidationError(`Branch "${baseBranch}" does not exist in the repository`)
            return
        }
        
        // Validate task content if creating as draft
        if (createAsDraft && !taskContent.trim()) {
            setValidationError('Please enter task content')
            return
        }
        
        // Replace spaces with underscores for the actual session name
        finalName = finalName.replace(/ /g, '_')
        
        const userEdited = wasEditedRef.current || (
            initialGeneratedNameRef.current && currentValue.trim() !== initialGeneratedNameRef.current
        )

        try {
            setCreating(true)
            
            // Save the selected branch as the project default for next time
            await invoke('set_project_default_base_branch', { branch: baseBranch })
                .catch(err => console.warn('Failed to save default branch:', err))
            
            await Promise.resolve(onCreate({
                name: finalName,
                prompt: createAsDraft ? undefined : (taskContent || undefined),
                baseBranch,
                // If user touched the input, treat name as manually edited
                userEditedName: !!userEdited,
                isDraft: createAsDraft,
                draftContent: createAsDraft ? taskContent : undefined,
            }))
            // On success the parent will close the modal; no need to reset creating here
        } catch (_e) {
            // Parent handles showing the error; re-enable to allow retry
            setCreating(false)
        }
    }, [creating, name, taskContent, baseBranch, onCreate, validateSessionName, createAsDraft, branches])

    // Keep ref in sync immediately on render to avoid stale closures in tests
    createRef.current = handleCreate

    useLayoutEffect(() => {
        if (open) {
            setCreating(false)
            // Generate a fresh Docker-style name each time the modal opens
            const gen = generateDockerStyleName()
            initialGeneratedNameRef.current = gen
            setName(gen)
            setWasEdited(false)
            wasEditedRef.current = false
            setTaskContent('')
            setValidationError('')
            setCreateAsDraft(initialIsDraft)
            setNameLocked(false)
            
            // Fetch available branches and the project-specific default branch
            setLoadingBranches(true)
            Promise.all([
                invoke<string[]>('list_project_branches'),
                invoke<string | null>('get_project_default_base_branch'),
                invoke<string>('get_project_default_branch'),
                invoke<boolean>('repository_is_empty')
            ])
                .then(([branchList, savedDefaultBranch, gitDefaultBranch, isEmpty]) => {
                    setBranches(branchList)
                    // Use saved default if available, otherwise use git default
                    const defaultBranch = savedDefaultBranch || gitDefaultBranch
                    setBaseBranch(defaultBranch)
                    setRepositoryIsEmpty(isEmpty)
                })
                .catch(err => {
                    console.warn('Failed to get branches:', err)
                    setBranches([])
                    setBaseBranch('')
                    setRepositoryIsEmpty(false)
                })
                .finally(() => setLoadingBranches(false))
            
            getSkipPermissions().then(setSkipPermissions)
            getAgentType().then(type => setAgentType(type as 'claude' | 'cursor' | 'opencode' | 'gemini'))
            
            // Focus the prompt textarea when modal opens
            setTimeout(() => {
                promptTextareaRef.current?.focus()
            }, 100)
        }
    }, [open, getSkipPermissions, getAgentType])

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
        const setDraftHandler = () => setCreateAsDraft(true)
        const prefillHandler = (event: any) => {
            const detail = event?.detail || {}
            const nameFromDraft: string | undefined = detail.name
            const taskContentFromDraft: string | undefined = detail.taskContent
            const baseBranchFromDraft: string | undefined = detail.baseBranch
            const lockName: boolean | undefined = detail.lockName

            if (nameFromDraft) {
                setName(nameFromDraft)
                // Treat this as user-provided name to avoid regen
                wasEditedRef.current = true
                setWasEdited(true)
                setNameLocked(!!lockName)
            }
            if (typeof taskContentFromDraft === 'string') {
                setTaskContent(taskContentFromDraft)
            }
            if (typeof baseBranchFromDraft === 'string' && baseBranchFromDraft) {
                setBaseBranch(baseBranchFromDraft)
            }
        }
        window.addEventListener('schaltwerk:new-session:set-draft' as any, setDraftHandler)
        window.addEventListener('schaltwerk:new-session:prefill' as any, prefillHandler)
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true)
            window.removeEventListener('schaltwerk:new-session:set-draft' as any, setDraftHandler)
            window.removeEventListener('schaltwerk:new-session:prefill' as any, prefillHandler)
        }
    }, [open, onClose])

    if (!open) return null

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="w-[720px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl">
                <div className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium">Start new task</div>
                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm text-slate-300 mb-1">Task name</label>
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
                        <label htmlFor="createAsDraft" className="text-sm text-slate-300">Create as draft (no agent will start)</label>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-300 mb-1">
                            {createAsDraft ? 'Task content' : 'Initial prompt (optional)'}
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
                            placeholder={createAsDraft ? "Enter task description in markdown..." : "Describe the task for the Claude session"} 
                        />
                        <p className="text-xs text-slate-400 mt-1">
                            {createAsDraft ? (
                                <>
                                    <svg className="inline-block w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    Draft tasks are saved for later. You can start them when ready.
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
                                    This repository has no commits yet. An initial commit will be created automatically when you start the task.
                                </p>
                            </div>
                        </div>
                    )}

                    <div className="grid grid-cols-3 gap-3">
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">Base branch</label>
                            {loadingBranches ? (
                                <input 
                                    value="Loading branches..." 
                                    disabled
                                    className="w-full bg-slate-800 text-slate-500 rounded px-3 py-2 border border-slate-700" 
                                />
                            ) : (
                                <BranchAutocomplete
                                    value={baseBranch}
                                    onChange={(value) => {
                                        setBaseBranch(value)
                                        // Clear validation error when user changes branch
                                        if (validationError && validationError.includes('Branch')) {
                                            setValidationError('')
                                        }
                                    }}
                                    branches={branches}
                                    disabled={branches.length === 0}
                                    placeholder={branches.length === 0 ? "No branches available" : "Type to search branches..."}
                                    onValidationChange={setIsValidBranch}
                                />
                            )}
                            <p className="text-xs text-slate-400 mt-1">Branch from which to create the worktree</p>
                        </div>
                        {!createAsDraft && (
                        <div>
                            <label className="block text-sm text-slate-300 mb-2">Agent</label>
                            <ModelSelector
                                value={agentType}
                                onChange={handleAgentTypeChange}
                                disabled={false}
                            />
                            <p className="text-xs text-slate-400 mt-2">AI agent to use for this session</p>
                        </div>
                        )}
                        {!createAsDraft && agentType !== 'opencode' && (
                            <div className="flex items-center gap-2">
                                <input id="skipPerms" type="checkbox" checked={skipPermissions} onChange={e => handleSkipPermissionsChange(e.target.checked)} />
                                <label htmlFor="skipPerms" className="text-sm text-slate-300">
                                    {agentType === 'cursor' ? 'Force flag' : 'Skip permissions'}
                                </label>
                            </div>
                        )}
                    </div>
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
                        disabled={!name.trim() || !baseBranch || !isValidBranch || creating || (createAsDraft && !taskContent.trim())}
                        className={`px-3 py-1.5 ${createAsDraft ? 'bg-amber-600 hover:bg-amber-500' : 'bg-blue-600 hover:bg-blue-500'} disabled:bg-slate-600 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2`}
                        title={!isValidBranch ? "Please select a valid branch" : createAsDraft ? "Create draft (Cmd+Enter)" : "Create task (Cmd+Enter)"}
                    >
                        {creating && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>{createAsDraft ? 'Create Draft' : 'Create'}</span>
                        {!creating && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">⌘↵</span>}
                    </button>
                </div>
            </div>
        </div>
    )
}


