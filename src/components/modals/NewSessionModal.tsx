import { useState, useEffect, useCallback, useRef, useLayoutEffect } from 'react'
import { generateDockerStyleName } from '../../utils/dockerNames'
import { invoke } from '@tauri-apps/api/core'
import { SessionConfigurationPanel } from '../shared/SessionConfigurationPanel'
import { theme } from '../../common/theme'
import { getPersistedSessionDefaults } from '../../utils/sessionConfig'
import { Dropdown } from '../inputs/Dropdown'
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'

interface Props {
    open: boolean
    initialIsDraft?: boolean
    onClose: () => void
    onCreate: (data: {
        name: string
        prompt?: string
        baseBranch: string
        userEditedName?: boolean
        isSpec?: boolean
        draftContent?: string
        versionCount?: number
    }) => void | Promise<void>
}

export function NewSessionModal({ open, initialIsDraft = false, onClose, onCreate }: Props) {
    const { registerModal, unregisterModal } = useModal()
    const [name, setName] = useState(() => generateDockerStyleName())
    const [, setWasEdited] = useState(false)
    const [taskContent, setTaskContent] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [agentType, setAgentType] = useState<'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex'>('claude')
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [creating, setCreating] = useState(false)
    const [createAsDraft, setCreateAsDraft] = useState(false)
    const [versionCount, setVersionCount] = useState<number>(1)
    const [showVersionMenu, setShowVersionMenu] = useState<boolean>(false)
    const [nameLocked, setNameLocked] = useState(false)
    const [repositoryIsEmpty, setRepositoryIsEmpty] = useState(false)
    const [isPrefillPending, setIsPrefillPending] = useState(false)
    const [hasPrefillData, setHasPrefillData] = useState(false)
    const [originalSpecName, setOriginalSpecName] = useState<string>('')
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

    const handleAgentTypeChange = (type: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex') => {
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
        
        // Validate spec content if creating as spec
         if (createAsDraft && !taskContent.trim()) {
             setValidationError('Please enter spec content')
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
                isSpec: createAsDraft,
                draftContent: createAsDraft ? taskContent : undefined,
                versionCount: createAsDraft ? 1 : versionCount,
            }
            logger.info('[NewSessionModal] Creating session with data:', {
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
    }, [creating, name, taskContent, baseBranch, onCreate, validateSessionName, createAsDraft, versionCount])

    // Keep ref in sync immediately on render to avoid stale closures in tests
    createRef.current = handleCreate

    // Track if the modal was previously open and with what initialIsDraft value
    const wasOpenRef = useRef(false)
    const lastInitialIsDraftRef = useRef<boolean | undefined>(undefined)

    // Register/unregister modal with context
    useEffect(() => {
        if (open) {
            registerModal('NewSessionModal')
        } else {
            unregisterModal('NewSessionModal')
        }
    }, [open, registerModal, unregisterModal])
    
    useLayoutEffect(() => {
        if (open) {
            logger.info('[NewSessionModal] Modal opened with:', {
                initialIsDraft,
                isPrefillPending,
                hasPrefillData,
                currentCreateAsDraft: createAsDraft,
                wasOpen: wasOpenRef.current,
                lastInitialIsDraft: lastInitialIsDraftRef.current
            })
            
            setCreating(false)
            // Generate a fresh Docker-style name each time the modal opens
            const gen = generateDockerStyleName()
            initialGeneratedNameRef.current = gen
            
            // Reset state if:
            // 1. We're not expecting prefill data AND don't already have it AND modal wasn't already open, OR
            // 2. The initialIsDraft prop changed (component re-rendered with different props)
            const initialIsDraftChanged = lastInitialIsDraftRef.current !== undefined && lastInitialIsDraftRef.current !== initialIsDraft
            const shouldReset = (!isPrefillPending && !hasPrefillData && !wasOpenRef.current) || initialIsDraftChanged
            
            if (shouldReset) {
                logger.info('[NewSessionModal] Resetting modal state - reason:', {
                    noPrefillAndWasntOpen: !isPrefillPending && !hasPrefillData && !wasOpenRef.current,
                    initialIsDraftChanged
                })
                setName(gen)
                setWasEdited(false)
                wasEditedRef.current = false
                setTaskContent('')
                setValidationError('')
                setCreateAsDraft(initialIsDraft)
                setNameLocked(false)
                setOriginalSpecName('')
                setShowVersionMenu(false)
                // Default version count is 1 (not from settings anymore)
                setVersionCount(1)
                // Initialize configuration from persisted state to reflect real settings
                getPersistedSessionDefaults()
                    .then(({ baseBranch, agentType, skipPermissions }) => {
                        if (baseBranch) setBaseBranch(baseBranch)
                        setAgentType(agentType)
                        setSkipPermissions(skipPermissions)
                        logger.info('[NewSessionModal] Initialized config from persisted state:', { baseBranch, agentType, skipPermissions })
                    })
                    .catch(e => {
                        logger.warn('[NewSessionModal] Failed loading persisted config, falling back to child init:', e)
                        setBaseBranch('')
                        setAgentType('claude')
                        setSkipPermissions(false)
                    })
            } else {
                logger.info('[NewSessionModal] Skipping full state reset - reason: prefill pending or has data or modal was already open and initialIsDraft unchanged')
                // Still need to reset some state
                setValidationError('')
                setCreating(false)
            }
            
            wasOpenRef.current = true
            lastInitialIsDraftRef.current = initialIsDraft
            
            // Check if repository is empty for display purposes
            invoke<boolean>('repository_is_empty')
                .then(setRepositoryIsEmpty)
                .catch(err => {
                    logger.warn('Failed to check if repository is empty:', err)
                    setRepositoryIsEmpty(false)
                })
            
            // Focus the prompt textarea when modal opens
            setTimeout(() => {
                promptTextareaRef.current?.focus()
            }, 100)
        } else {
            // Reset ALL state when modal closes to prevent stale state
            logger.info('[NewSessionModal] Modal closed - resetting all state')
            setIsPrefillPending(false)
            setHasPrefillData(false)
            setCreateAsDraft(false)
            setNameLocked(false)
            setOriginalSpecName('')
            setTaskContent('')
            setName('')
            setValidationError('')
            setCreating(false)
            setBaseBranch('')
            setAgentType('claude')
            setSkipPermissions(false)
            setVersionCount(1)
            setShowVersionMenu(false)
            wasOpenRef.current = false
            lastInitialIsDraftRef.current = undefined
        }
    }, [open, initialIsDraft, isPrefillPending, hasPrefillData, createAsDraft])

    // Register prefill event listener immediately, not dependent on open state
    // This ensures we can catch events that are dispatched right when the modal opens
    useEffect(() => {
        const prefillHandler = (event: CustomEvent) => {
            logger.info('[NewSessionModal] Received prefill event with detail:', event?.detail)
            const detail = event?.detail || {}
            const nameFromDraft: string | undefined = detail.name
            const taskContentFromDraft: string | undefined = detail.taskContent
            const lockName: boolean | undefined = detail.lockName
            const fromDraft: boolean | undefined = detail.fromDraft
            const baseBranchFromDraft: string | undefined = detail.baseBranch
            const originalSpecNameFromDraft: string | undefined = detail.originalSpecName

            if (nameFromDraft) {
                logger.info('[NewSessionModal] Setting name from prefill:', nameFromDraft)
                setName(nameFromDraft)
                // Treat this as user-provided name to avoid regen
                wasEditedRef.current = true
                setWasEdited(true)
                setNameLocked(!!lockName)
            }
            if (typeof taskContentFromDraft === 'string') {
                logger.info('[NewSessionModal] Setting agent content from prefill:', taskContentFromDraft.substring(0, 100), '...')
                setTaskContent(taskContentFromDraft)
            }
            if (baseBranchFromDraft) {
                logger.info('[NewSessionModal] Setting base branch from prefill:', baseBranchFromDraft)
                setBaseBranch(baseBranchFromDraft)
            }
            if (originalSpecNameFromDraft) {
                logger.info('[NewSessionModal] Setting original spec name from prefill:', originalSpecNameFromDraft)
                setOriginalSpecName(originalSpecNameFromDraft)
            }
            // If running from an existing spec, don't create another spec
             if (fromDraft) {
                 logger.info('[NewSessionModal] Running from existing spec - forcing createAsDraft to false')
                 setCreateAsDraft(false)
             }
            
            // Clear the prefill pending flag and mark that we have data
            setIsPrefillPending(false)
            setHasPrefillData(true)
            logger.info('[NewSessionModal] Prefill data processed, hasPrefillData set to true')
        }
        
        // Listen for a notification that prefill is coming
        const prefillPendingHandler = () => {
            logger.info('[NewSessionModal] Prefill pending notification received')
            setIsPrefillPending(true)
        }
        
        window.addEventListener('schaltwerk:new-session:prefill' as keyof WindowEventMap, prefillHandler as EventListener)
        window.addEventListener('schaltwerk:new-session:prefill-pending' as keyof WindowEventMap, prefillPendingHandler as EventListener)
        return () => {
            window.removeEventListener('schaltwerk:new-session:prefill' as keyof WindowEventMap, prefillHandler as EventListener)
            window.removeEventListener('schaltwerk:new-session:prefill-pending' as keyof WindowEventMap, prefillPendingHandler as EventListener)
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
            logger.info('[NewSessionModal] Received set-spec event - setting createAsDraft to true')
            setCreateAsDraft(true)
        }
        window.addEventListener('schaltwerk:new-session:set-spec', setDraftHandler)
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true)
            window.removeEventListener('schaltwerk:new-session:set-spec', setDraftHandler)
        }
    }, [open, onClose, createAsDraft])

    if (!open) return null

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center" style={{ backgroundColor: theme.colors.overlay.backdrop }}>
            <div className="w-[720px] max-w-[95vw] rounded-xl shadow-xl" style={{ backgroundColor: theme.colors.background.tertiary, borderColor: theme.colors.border.subtle, border: '1px solid' }}>
                <div className="px-4 py-3 border-b font-medium" style={{ borderBottomColor: theme.colors.border.default, color: theme.colors.text.primary }}>{createAsDraft ? "Create new spec" : "Start new agent"}</div>
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
                        {originalSpecName && (
                            <div className="flex items-center justify-between mt-2 px-2 py-1 rounded text-xs" style={{ backgroundColor: theme.colors.background.elevated, border: `1px solid ${theme.colors.border.subtle}` }}>
                                <div className="flex items-center gap-2">
                                    <svg className="w-3 h-3 flex-shrink-0" style={{ color: theme.colors.accent.blue.DEFAULT }} fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v1.5h16V5a2 2 0 00-2-2H4zm14 6H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM2 7h16v1H2V7z" clipRule="evenodd" />
                                    </svg>
                                    <span style={{ color: theme.colors.text.secondary }}>From spec: <span style={{ color: theme.colors.text.primary }}>{originalSpecName}</span></span>
                                </div>
                                {name !== originalSpecName && (
                                    <button 
                                        type="button"
                                        onClick={() => {
                                            setName(originalSpecName)
                                            setWasEdited(true)
                                            wasEditedRef.current = true
                                        }}
                                        className="ml-2 px-2 py-0.5 rounded text-xs hover:opacity-80"
                                        style={{ backgroundColor: theme.colors.accent.blue.bg, color: theme.colors.accent.blue.DEFAULT }}
                                        title="Reset to original spec name"
                                    >
                                        Reset
                                    </button>
                                )}
                            </div>
                        )}
                    </div>

                    <div className="flex items-center gap-2 mb-2">
                        <input 
                            id="createAsDraft" 
                            type="checkbox" 
                            checked={createAsDraft} 
                            onChange={e => {
                                setCreateAsDraft(e.target.checked)
                                // Clear validation error when switching modes to prevent stale errors
                                if (validationError) {
                                    setValidationError('')
                                }
                            }} 
                            className="text-blue-600"
                        />
                        <label htmlFor="createAsDraft" className="text-sm text-slate-300">Create as spec (no agent will start)</label>
                    </div>

                    <div>
                        <label className="block text-sm text-slate-300 mb-1">
                            {createAsDraft ? 'Spec content' : 'Initial prompt (optional)'}
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
                            placeholder={createAsDraft ? "Enter spec content in markdown..." : "Describe the agent for the Claude session"} 
                        />
                        <p className="text-xs text-slate-400 mt-1">
                            {createAsDraft && (
                                <>
                                    <svg className="inline-block w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    Spec agents are saved for later. You can start them when ready.
                                </>
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
                <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2 relative">
                    {!createAsDraft && (
                        <Dropdown
                          open={showVersionMenu}
                          onOpenChange={setShowVersionMenu}
                          items={([1,2,3,4] as const).map(n => ({ key: String(n), label: `${n} ${n === 1 ? 'version' : 'versions'}` }))}
                          selectedKey={String(versionCount)}
                          align="right"
                          onSelect={(key) => setVersionCount(parseInt(key))}
                          menuTestId="version-selector-menu"
                        >
                          {({ open, toggle }) => (
                            <button
                              type="button"
                              data-testid="version-selector"
                              onClick={toggle}
                              className="px-2 h-9 rounded inline-flex items-center gap-2 hover:opacity-90"
                              style={{
                                backgroundColor: open ? theme.colors.background.hover : theme.colors.background.elevated,
                                color: theme.colors.text.primary,
                                border: `1px solid ${open ? theme.colors.border.default : theme.colors.border.subtle}`,
                              }}
                              title="Number of parallel versions"
                            >
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', verticalAlign: 'middle' }}>
                                <path d="M12 2L3 6l9 4 9-4-9-4z" fill={theme.colors.text.primary} fillOpacity={0.9}/>
                                <path d="M3 10l9 4 9-4" stroke={theme.colors.text.primary} strokeOpacity={0.5} strokeWidth={1.2}/>
                                <path d="M3 14l9 4 9-4" stroke={theme.colors.text.primary} strokeOpacity={0.35} strokeWidth={1.2}/>
                              </svg>
                              <span style={{ lineHeight: 1 }}>{versionCount}x</span>
                              <svg width="12" height="12" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                                <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                              </svg>
                            </button>
                          )}
                        </Dropdown>
                    )}
                    <button 
                        onClick={onClose} 
                        className="px-3 h-9 rounded group relative hover:opacity-90 inline-flex items-center"
                        style={{ backgroundColor: theme.colors.background.elevated, color: theme.colors.text.primary, border: `1px solid ${theme.colors.border.subtle}` }}
                        title="Cancel (Esc)"
                    >
                        Cancel
                        <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
                    </button>
                    <button 
                        onClick={handleCreate} 
                        disabled={!name.trim() || (!createAsDraft && !baseBranch) || creating || (createAsDraft && !taskContent.trim())}
                        className={`px-3 h-9 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2 ${(!name.trim() || (!createAsDraft && !baseBranch) || creating || (createAsDraft && !taskContent.trim())) ? 'opacity-60' : 'hover:opacity-90'}`}
                        style={{ 
                            backgroundColor: createAsDraft ? theme.colors.accent.amber.DEFAULT : theme.colors.accent.blue.DEFAULT,
                            opacity: creating ? 0.9 : 1
                        }}
                        title={createAsDraft ? "Create spec (Cmd+Enter)" : "Start agent (Cmd+Enter)"}
                    >
                        {creating && (
                            <span
                                className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-white/60 border-t-transparent"
                                aria-hidden="true"
                            />
                        )}
                        <span>{createAsDraft ? "Create Spec" : "Start Agent"}</span>
                        {!creating && <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">⌘↵</span>}
                    </button>
                </div>
            </div>
        </div>
    )
}
