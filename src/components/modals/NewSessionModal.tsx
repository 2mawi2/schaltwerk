import { useState, useEffect, useCallback, useRef, useLayoutEffect, lazy, Suspense } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { generateDockerStyleName } from '../../utils/dockerNames'
import { invoke } from '@tauri-apps/api/core'
import { SessionConfigurationPanel } from '../shared/SessionConfigurationPanel'
import { theme } from '../../common/theme'
import { getPersistedSessionDefaults } from '../../utils/sessionConfig'
import { Dropdown } from '../inputs/Dropdown'
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'
import { UiEvent, listenUiEvent, NewSessionPrefillDetail } from '../../common/uiEvents'
import {
    AgentCliArgsState,
    AgentEnvVar,
    AgentEnvVarState,
    createEmptyCliArgsState,
    createEmptyEnvVarState,
} from '../shared/agentDefaults'
import { AgentDefaultsSection } from '../shared/AgentDefaultsSection'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import type { MarkdownEditorRef } from '../plans/MarkdownEditor'
import { ResizableModal } from '../shared/ResizableModal'

const MarkdownEditor = lazy(() => import('../plans/MarkdownEditor').then(m => ({ default: m.MarkdownEditor })))

interface Props {
    open: boolean
    initialIsDraft?: boolean
    cachedPrompt?: string
    onPromptChange?: (prompt: string) => void
    onClose: () => void
    onCreate: (data: {
        name: string
        prompt?: string
        baseBranch: string
        customBranch?: string
        userEditedName?: boolean
        isSpec?: boolean
        draftContent?: string
        versionCount?: number
        agentType?: AgentType
        skipPermissions?: boolean
    }) => void | Promise<void>
}

export function NewSessionModal({ open, initialIsDraft = false, cachedPrompt = '', onPromptChange, onClose, onCreate }: Props) {
    const { registerModal, unregisterModal } = useModal()
    const [name, setName] = useState(() => generateDockerStyleName())
    const [, setWasEdited] = useState(false)
    const [taskContent, setTaskContent] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [customBranch, setCustomBranch] = useState('')
    const [agentType, setAgentType] = useState<AgentType>('claude')
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
    const [agentEnvVars, setAgentEnvVars] = useState<AgentEnvVarState>(createEmptyEnvVarState)
    const [agentCliArgs, setAgentCliArgs] = useState<AgentCliArgsState>(createEmptyCliArgsState)
    const [agentConfigLoading, setAgentConfigLoading] = useState(false)
    const [ignorePersistedAgentType, setIgnorePersistedAgentType] = useState(false)
    const nameInputRef = useRef<HTMLInputElement>(null)
    const markdownEditorRef = useRef<MarkdownEditorRef>(null)
    const hasFocusedDuringOpenRef = useRef(false)
    const projectFileIndex = useProjectFileIndex()
    const wasEditedRef = useRef(false)
    const createRef = useRef<() => void>(() => {})
    const initialGeneratedNameRef = useRef<string>('')
    const lastAgentTypeRef = useRef<AgentType>('claude')
    const hasAgentOverrideRef = useRef(false)
    const lastSupportedSkipPermissionsRef = useRef(false)

    const handleBranchChange = (branch: string) => {
        setBaseBranch(branch)
        // Clear validation error when user changes branch
        if (validationError && validationError.includes('Branch')) {
            setValidationError('')
        }
    }

    const handleAgentTypeChange = useCallback((type: AgentType) => {
        const previousAgent = lastAgentTypeRef.current
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[previousAgent]) {
            lastSupportedSkipPermissionsRef.current = skipPermissions
        }

        logger.info(`[NewSessionModal] Agent type change requested ${JSON.stringify({
            nextType: type,
            previousType: previousAgent,
            overrideBefore: hasAgentOverrideRef.current
        })}`)

        setAgentType(type)
        lastAgentTypeRef.current = type
        hasAgentOverrideRef.current = true
        let nextSkipState = skipPermissions
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[type]) {
            const restoredPreference = lastSupportedSkipPermissionsRef.current
            setSkipPermissions(restoredPreference)
            nextSkipState = restoredPreference
            logger.info('[NewSessionModal] Restored skip permissions preference for supported agent', {
                agentType: type,
                restoredPreference
            })
        } else if (skipPermissions) {
            setSkipPermissions(false)
            nextSkipState = false
            logger.info('[NewSessionModal] Cleared skip permissions for unsupported agent', { agentType: type })
        }

        logger.info(`[NewSessionModal] Agent type change applied ${JSON.stringify({
            lastAgentType: lastAgentTypeRef.current,
            overrideAfter: hasAgentOverrideRef.current,
            skipPermissions: nextSkipState
        })}`)
    }, [skipPermissions])

    const handleSkipPermissionsChange = (enabled: boolean) => {
        setSkipPermissions(enabled)
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[lastAgentTypeRef.current]) {
            lastSupportedSkipPermissionsRef.current = enabled
        }
    }

    useEffect(() => {
        if (AGENT_SUPPORTS_SKIP_PERMISSIONS[agentType]) {
            lastSupportedSkipPermissionsRef.current = skipPermissions
        }
    }, [agentType, skipPermissions])

    const persistAgentCliArgs = useCallback(async (agent: AgentType, value: string) => {
        try {
            await invoke(TauriCommands.SetAgentCliArgs, { agentType: agent, cliArgs: value })
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to persist CLI args for agent', agent, error)
        }
    }, [])

    const persistAgentEnvVars = useCallback(async (agent: AgentType, vars: AgentEnvVar[]) => {
        const envVarPayload = vars.reduce<Record<string, string>>((acc, item) => {
            const trimmedKey = item.key.trim()
            if (trimmedKey) {
                acc[trimmedKey] = item.value
            }
            return acc
        }, {})

        try {
            await invoke(TauriCommands.SetAgentEnvVars, { agentType: agent, envVars: envVarPayload })
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to persist env vars for agent', agent, error)
        }
    }, [])

    const updateEnvVarsForAgent = useCallback(
        (updater: (vars: AgentEnvVar[]) => AgentEnvVar[]) => {
            setAgentEnvVars(prev => {
                const currentList = prev[agentType] || []
                const updatedList = updater(currentList)
                const next = { ...prev, [agentType]: updatedList }
                void persistAgentEnvVars(agentType, updatedList)
                return next
            })
        },
        [agentType, persistAgentEnvVars]
    )

    const handleCliArgsChange = useCallback(
        (value: string) => {
            setAgentCliArgs(prev => {
                if (prev[agentType] === value) {
                    return prev
                }
                return { ...prev, [agentType]: value }
            })
            void persistAgentCliArgs(agentType, value)
        },
        [agentType, persistAgentCliArgs]
    )

    const handleEnvVarChange = useCallback(
        (index: number, field: 'key' | 'value', value: string) => {
            updateEnvVarsForAgent(current =>
                current.map((item, idx) => (idx === index ? { ...item, [field]: value } : item))
            )
        },
        [updateEnvVarsForAgent]
    )

    const handleAddEnvVar = useCallback(() => {
        updateEnvVarsForAgent(current => [...current, { key: '', value: '' }])
    }, [updateEnvVarsForAgent])

    const handleRemoveEnvVar = useCallback(
        (index: number) => {
            updateEnvVarsForAgent(current => current.filter((_, idx) => idx !== index))
        },
        [updateEnvVarsForAgent]
    )

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
                customBranch: customBranch.trim() || undefined,
                userEditedName: !!userEdited,
                isSpec: createAsDraft,
                draftContent: createAsDraft ? taskContent : undefined,
                versionCount: createAsDraft ? 1 : versionCount,
                agentType,
                skipPermissions: createAsDraft ? skipPermissions : undefined,
            }

            logger.info('[NewSessionModal] Creating session with data:', {
                ...createData,
                createAsDraft,
                taskContent: taskContent ? taskContent.substring(0, 100) + (taskContent.length > 100 ? '...' : '') : undefined,
                promptWillBe: createData.prompt ? createData.prompt.substring(0, 100) + (createData.prompt.length > 100 ? '...' : '') : undefined
            })
            await Promise.resolve(onCreate(createData))
        } catch (_e) {
            setCreating(false)
        }
    }, [creating, name, taskContent, baseBranch, customBranch, onCreate, validateSessionName, createAsDraft, versionCount, agentType, skipPermissions])

    // Keep ref in sync immediately on render to avoid stale closures in tests
    createRef.current = handleCreate

    // Track if the modal was previously open and with what initialIsDraft value
    const wasOpenRef = useRef(false)
    const lastInitialIsDraftRef = useRef<boolean | undefined>(undefined)
    useEffect(() => {
        if (!open) return

        let cancelled = false

        const loadAgentDefaults = async () => {
            setAgentConfigLoading(true)
            try {
                const envResults = await Promise.all(
                    AGENT_TYPES.map(async agent => {
                        try {
                            const result = await invoke<Record<string, string>>(TauriCommands.GetAgentEnvVars, { agentType: agent })
                            return result || {}
                        } catch (error) {
                            logger.warn('[NewSessionModal] Failed to load env vars for agent', agent, error)
                            return {}
                        }
                    })
                )

                const cliResults = await Promise.all(
                    AGENT_TYPES.map(async agent => {
                        try {
                            const result = await invoke<string>(TauriCommands.GetAgentCliArgs, { agentType: agent })
                            return result || ''
                        } catch (error) {
                            logger.warn('[NewSessionModal] Failed to load CLI args for agent', agent, error)
                            return ''
                        }
                    })
                )

                if (cancelled) {
                    return
                }

                setAgentEnvVars(() => {
                    const next = createEmptyEnvVarState()
                    AGENT_TYPES.forEach((agent, index) => {
                        const raw = envResults[index] || {}
                        next[agent] = Object.entries(raw).map(([key, value]) => ({ key, value }))
                    })
                    return next
                })

                setAgentCliArgs(() => {
                    const next = createEmptyCliArgsState()
                    AGENT_TYPES.forEach((agent, index) => {
                        const result = cliResults[index]
                        next[agent] = typeof result === 'string' ? result : ''
                    })
                    return next
                })
            } catch (error) {
                if (!cancelled) {
                    logger.warn('[NewSessionModal] Failed to load agent defaults', error)
                    setAgentEnvVars(createEmptyEnvVarState())
                    setAgentCliArgs(createEmptyCliArgsState())
                }
            } finally {
                if (!cancelled) {
                    setAgentConfigLoading(false)
                }
            }
        }

        void loadAgentDefaults()

        return () => {
            cancelled = true
        }
    }, [open])

    // Register/unregister modal with context using layout effect to minimize timing gaps
    useLayoutEffect(() => {
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
                setTaskContent(cachedPrompt)
                setValidationError('')
                setCreateAsDraft(initialIsDraft)
                setCustomBranch('')
                setNameLocked(false)
                setOriginalSpecName('')
                setShowVersionMenu(false)
                setVersionCount(1)
                const shouldIgnorePersisted = hasAgentOverrideRef.current
                setIgnorePersistedAgentType(shouldIgnorePersisted)
                logger.info(`[NewSessionModal] Applying last agent type before defaults ${JSON.stringify({
                    lastAgentType: lastAgentTypeRef.current,
                    hasOverride: hasAgentOverrideRef.current,
                    ignorePersisted: shouldIgnorePersisted
                })}`)
                setAgentType(lastAgentTypeRef.current)
                // Initialize configuration from persisted state to reflect real settings
                getPersistedSessionDefaults()
                    .then(({ baseBranch, agentType, skipPermissions }) => {
                        if (baseBranch) setBaseBranch(baseBranch)
                        if (!shouldIgnorePersisted) {
                            logger.info(`[NewSessionModal] Using persisted agent type from defaults ${JSON.stringify({ persistedAgentType: agentType })}`)
                            setAgentType(agentType)
                            lastAgentTypeRef.current = agentType
                        } else {
                            logger.info(`[NewSessionModal] Ignoring persisted agent type in favour of override ${JSON.stringify({
                                persistedAgentType: agentType,
                                lastAgentType: lastAgentTypeRef.current
                            })}`)
                        }
                        setSkipPermissions(skipPermissions)
                        logger.info('[NewSessionModal] Initialized config from persisted state:', { baseBranch, agentType, skipPermissions })
                    })
                    .catch(e => {
                        logger.warn('[NewSessionModal] Failed loading persisted config, falling back to child init:', e)
                        setBaseBranch('')
                        if (!shouldIgnorePersisted) {
                            logger.info(`[NewSessionModal] Falling back to claude defaults ${JSON.stringify({ hasOverride: hasAgentOverrideRef.current })}`)
                            setAgentType('claude')
                            lastAgentTypeRef.current = 'claude'
                        }
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
            invoke<boolean>(TauriCommands.RepositoryIsEmpty)
                .then(setRepositoryIsEmpty)
                .catch(err => {
                    logger.warn('Failed to check if repository is empty:', err)
                    setRepositoryIsEmpty(false)
                })

            if (!hasFocusedDuringOpenRef.current) {
                hasFocusedDuringOpenRef.current = true
                setTimeout(() => {
                    if (cachedPrompt) {
                        markdownEditorRef.current?.focusEnd()
                    } else {
                        markdownEditorRef.current?.focus()
                    }
                }, 100)
            }
        } else {
            setIgnorePersistedAgentType(hasAgentOverrideRef.current)
            logger.info(`[NewSessionModal] Modal closed - resetting all state except taskContent ${JSON.stringify({
                lastAgentType: lastAgentTypeRef.current,
                hasOverride: hasAgentOverrideRef.current
            })}`)
            setIsPrefillPending(false)
            setHasPrefillData(false)
            setCreateAsDraft(false)
            setCustomBranch('')
            setNameLocked(false)
            setOriginalSpecName('')
            setName('')
            setValidationError('')
            setCreating(false)
            setBaseBranch('')
            setAgentType(lastAgentTypeRef.current)
            setSkipPermissions(false)
            setVersionCount(1)
            setShowVersionMenu(false)
            logger.info(`[NewSessionModal] Reapplying last agent type on close path ${JSON.stringify({
                lastAgentType: lastAgentTypeRef.current,
                hasOverride: hasAgentOverrideRef.current
            })}`)
            setAgentEnvVars(createEmptyEnvVarState())
            setAgentCliArgs(createEmptyCliArgsState())
            setAgentConfigLoading(false)
            wasOpenRef.current = false
            lastInitialIsDraftRef.current = undefined
            hasFocusedDuringOpenRef.current = false
        }
    }, [open, initialIsDraft, isPrefillPending, hasPrefillData, createAsDraft, cachedPrompt])

    const ensureProjectFiles = projectFileIndex.ensureIndex

    useEffect(() => {
        if (!open) return
        void ensureProjectFiles()
    }, [open, ensureProjectFiles])

    // Register prefill event listener immediately, not dependent on open state
    // This ensures we can catch events that are dispatched right when the modal opens
    useEffect(() => {
        const prefillHandler = (detailArg?: NewSessionPrefillDetail) => {
            logger.info('[NewSessionModal] Received prefill event with detail:', detailArg)
            const detail = detailArg || {}
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
        
        const cleanupPrefill = listenUiEvent(UiEvent.NewSessionPrefill, prefillHandler)
        const cleanupPending = listenUiEvent(UiEvent.NewSessionPrefillPending, prefillPendingHandler)
        return () => {
            cleanupPrefill()
            cleanupPending()
        }
    }, [])

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }
                onClose()
            } else if (e.key === 'Enter' && e.metaKey) {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }
                createRef.current()
            } else if ((e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.metaKey) {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }

                const currentIndex = AGENT_TYPES.indexOf(agentType)
                let nextIndex: number

                if (e.key === 'ArrowUp') {
                    nextIndex = currentIndex === 0 ? AGENT_TYPES.length - 1 : currentIndex - 1
                } else {
                    nextIndex = currentIndex === AGENT_TYPES.length - 1 ? 0 : currentIndex + 1
                }

                handleAgentTypeChange(AGENT_TYPES[nextIndex])
            }
        }

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
    }, [open, onClose, agentType, handleAgentTypeChange])

    if (!open) return null

    const isStartDisabled =
        !name.trim() ||
        (!createAsDraft && !baseBranch) ||
        creating ||
        (createAsDraft && !taskContent.trim())

    const footer = (
        <>
            {!createAsDraft && agentType !== 'terminal' && (
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
                disabled={isStartDisabled}
                className={`px-3 h-9 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2 ${isStartDisabled ? 'opacity-60' : 'hover:opacity-90'}`}
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
        </>
    )

    return (
        <ResizableModal
            isOpen={open}
            onClose={onClose}
            title={createAsDraft ? "Create new spec" : "Start new agent"}
            storageKey="new-session"
            defaultWidth={720}
            defaultHeight={700}
            minWidth={600}
            minHeight={500}
            footer={footer}
        >
            <div className="flex flex-col h-full p-4 gap-4">
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

                    <div className="flex items-center gap-2">
                        <input
                            id="createAsDraft"
                            type="checkbox"
                            checked={createAsDraft}
                            onChange={e => {
                                setCreateAsDraft(e.target.checked)
                                if (validationError) {
                                    setValidationError('')
                                }
                            }}
                            style={{ color: theme.colors.accent.cyan.DEFAULT }}
                        />
                        <label htmlFor="createAsDraft" className="text-sm text-slate-300">Create as spec (no agent will start)</label>
                    </div>

                    <div className="flex flex-col flex-1 min-h-0">
                        <label className="block text-sm text-slate-300 mb-1">
                            {createAsDraft ? 'Spec content' : 'Initial prompt (optional)'}
                        </label>
                        <Suspense fallback={<div className="flex-1 rounded border border-slate-700" style={{ backgroundColor: theme.colors.background.elevated }} /> }>
                            <div className="flex-1 min-h-0 overflow-hidden" data-testid="session-task-editor">
                                <MarkdownEditor
                                    ref={markdownEditorRef}
                                    value={taskContent}
                                    onChange={value => {
                                        setTaskContent(value)
                                        onPromptChange?.(value)
                                        if (validationError) {
                                            setValidationError('')
                                        }
                                    }}
                                    placeholder={createAsDraft ? 'Enter spec content in markdown...' : 'Describe the agent for the Claude session'}
                                    className="h-full"
                                    fileReferenceProvider={projectFileIndex}
                                />
                            </div>
                        </Suspense>
                        <p className="text-xs text-slate-400 mt-1">
                            {createAsDraft ? (
                                <>
                                    <svg className="inline-block w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z" clipRule="evenodd" />
                                    </svg>
                                    Spec agents are saved for later. You can start them when ready. Type @ to reference project files.
                                </>
                            ) : (
                                'Type @ to reference project files.'
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
                        <>
                            <SessionConfigurationPanel
                                variant="modal"
                                onBaseBranchChange={handleBranchChange}
                                onAgentTypeChange={handleAgentTypeChange}
                                onSkipPermissionsChange={handleSkipPermissionsChange}
                                onCustomBranchChange={(branch) => {
                                    setCustomBranch(branch)
                                    if (validationError) {
                                        setValidationError('')
                                    }
                                }}
                                initialBaseBranch={baseBranch}
                                initialAgentType={agentType}
                                initialSkipPermissions={skipPermissions}
                                initialCustomBranch={customBranch}
                                sessionName={name}
                                ignorePersistedAgentType={ignorePersistedAgentType}
                            />
                            <AgentDefaultsSection
                                agentType={agentType}
                                cliArgs={agentCliArgs[agentType] || ''}
                                onCliArgsChange={handleCliArgsChange}
                                envVars={agentEnvVars[agentType]}
                                onEnvVarChange={handleEnvVarChange}
                                onAddEnvVar={handleAddEnvVar}
                                onRemoveEnvVar={handleRemoveEnvVar}
                                loading={agentConfigLoading}
                            />
                            {agentType === 'terminal' && (
                                <div className="bg-blue-900/30 border border-blue-700/50 rounded-lg p-3 flex items-start gap-2">
                                    <svg className="w-5 h-5 text-blue-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="text-sm text-blue-200">
                                        <p className="font-medium mb-1">Terminal-only mode</p>
                                        <p className="text-xs text-blue-300">
                                            No AI agent will be started. A terminal will open with your default shell for custom development or running custom agents manually. The initial prompt above will not be pasted.
                                        </p>
                                    </div>
                                </div>
                            )}
                        </>
                    )}
                </div>
        </ResizableModal>
    )
}
