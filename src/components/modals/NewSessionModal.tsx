import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { generateDockerStyleName } from '../../utils/dockerNames'
import { promptToSessionName } from '../../utils/promptToSessionName'
import { titleToSessionName } from '../../utils/titleToSessionName'
import { invoke } from '@tauri-apps/api/core'
import { SessionConfigurationPanel } from '../shared/SessionConfigurationPanel'
import { getPersistedSessionDefaults } from '../../utils/sessionConfig'
import { Dropdown } from '../inputs/Dropdown'
import { logger } from '../../utils/logger'
import { useModal } from '../../contexts/ModalContext'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS, createAgentRecord } from '../../types/session'
import { UiEvent, listenUiEvent, NewSessionPrefillDetail } from '../../common/uiEvents'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import {
    AgentCliArgsState,
    AgentEnvVar,
    AgentEnvVarState,
    createEmptyCliArgsState,
    createEmptyEnvVarState,
    displayNameForAgent,
} from '../shared/agentDefaults'
import { AgentDefaultsSection } from '../shared/AgentDefaultsSection'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import { MarkdownEditor, type MarkdownEditorRef } from '../specs/MarkdownEditor'
import { ResizableModal } from '../shared/ResizableModal'
import { GitHubIssuePromptSection } from './GitHubIssuePromptSection'
import { GitHubPrPromptSection } from './GitHubPrPromptSection'
import type { GithubIssueSelectionResult, GithubPrSelectionResult } from '../../types/githubIssues'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { FALLBACK_CODEX_MODELS, getCodexModelMetadata } from '../../common/codexModels'
import { loadCodexModelCatalog, CodexModelCatalog } from '../../services/codexModelCatalog'
import { EpicSelect } from '../shared/EpicSelect'
import { useEpics } from '../../hooks/useEpics'
import {
    MAX_VERSION_COUNT,
    MULTI_AGENT_TYPES,
    VERSION_DROPDOWN_ITEMS,
    MultiAgentAllocationDropdown,
    type MultiAgentAllocations,
    sumAllocations,
    normalizeAllocations,
} from './MultiAgentAllocationDropdown'

const SESSION_NAME_ALLOWED_PATTERN = /^[\p{L}\p{M}\p{N}_\- ]+$/u

type AgentPreferenceField = 'model' | 'reasoningEffort'

interface AgentPreferenceState {
    model?: string
    reasoningEffort?: string
}

const createEmptyPreferenceState = () =>
    createAgentRecord<AgentPreferenceState>(() => ({ model: '', reasoningEffort: '' }))

function isBranchValidationError(errorMessage: string): boolean {
    return errorMessage.includes('Branch') || errorMessage.includes('worktree')
}

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
        useExistingBranch?: boolean
        syncWithOrigin?: boolean
        userEditedName?: boolean
        isSpec?: boolean
        draftContent?: string
        versionCount?: number
        agentType?: AgentType
        agentTypes?: AgentType[]
        skipPermissions?: boolean
        prNumber?: number
        prUrl?: string
        epicId?: string | null
    }) => void | Promise<void>
}

type CreateSessionPayload = Parameters<Props['onCreate']>[0]

export function NewSessionModal({ open, initialIsDraft = false, cachedPrompt = '', onPromptChange, onClose, onCreate }: Props) {
    const { registerModal, unregisterModal } = useModal()
    const { isAvailable } = useAgentAvailability({ autoLoad: open })
    const { epics, ensureLoaded: ensureEpicsLoaded } = useEpics()
    const githubIntegration = useGithubIntegrationContext()
    const [name, setName] = useState(() => generateDockerStyleName())
    const [, setWasEdited] = useState(false)
    const [taskContent, setTaskContent] = useState('')
    const [baseBranch, setBaseBranch] = useState('')
    const [customBranch, setCustomBranch] = useState('')
    const [useExistingBranch, setUseExistingBranch] = useState(false)
    const [agentType, setAgentType] = useState<AgentType>('claude')
    const [skipPermissions, setSkipPermissions] = useState(false)
    const [validationError, setValidationError] = useState('')
    const [creating, setCreating] = useState(false)
    const [createAsDraft, setCreateAsDraft] = useState(false)
    const [versionCount, setVersionCount] = useState<number>(1)
    const [multiAgentMode, setMultiAgentMode] = useState(false)
    const [multiAgentAllocations, setMultiAgentAllocations] = useState<MultiAgentAllocations>({})
    const [showVersionMenu, setShowVersionMenu] = useState<boolean>(false)
    const [nameLocked, setNameLocked] = useState(false)
    const [epicId, setEpicId] = useState<string | null>(null)
    const [repositoryIsEmpty, setRepositoryIsEmpty] = useState(false)
    const [isPrefillPending, setIsPrefillPending] = useState(false)
    const [hasPrefillData, setHasPrefillData] = useState(false)
    const [originalSpecName, setOriginalSpecName] = useState<string>('')
    const [agentEnvVars, setAgentEnvVars] = useState<AgentEnvVarState>(createEmptyEnvVarState)
    const [agentCliArgs, setAgentCliArgs] = useState<AgentCliArgsState>(createEmptyCliArgsState)
    const [agentPreferences, setAgentPreferences] = useState<Record<AgentType, AgentPreferenceState>>(createEmptyPreferenceState)
    const [agentConfigLoading, setAgentConfigLoading] = useState(false)
    const [ignorePersistedAgentType, setIgnorePersistedAgentType] = useState(false)
    const [promptSource, setPromptSource] = useState<'custom' | 'github_issue' | 'github_pull_request'>('custom')
    const [manualPromptDraft, setManualPromptDraft] = useState(cachedPrompt)
    const [githubIssueSelection, setGithubIssueSelection] = useState<GithubIssueSelectionResult | null>(null)
    const [githubPrSelection, setGithubPrSelection] = useState<GithubPrSelectionResult | null>(null)
    const [githubIssueLoading, setGithubIssueLoading] = useState(false)
    const [githubPrLoading, setGithubPrLoading] = useState(false)
    const nameInputRef = useRef<HTMLInputElement>(null)
    const markdownEditorRef = useRef<MarkdownEditorRef>(null)
    const hasFocusedDuringOpenRef = useRef(false)
    const focusTimeoutRef = useRef<number | undefined>(undefined)
    const projectFileIndex = useProjectFileIndex()
    const wasEditedRef = useRef(false)
    const createRef = useRef<() => void>(() => {})
    const initialGeneratedNameRef = useRef<string>('')
    const lastAgentTypeRef = useRef<AgentType>('claude')
    const hasAgentOverrideRef = useRef(false)
    const lastSupportedSkipPermissionsRef = useRef(false)
    const lastOpenStateRef = useRef(false)
    const githubPromptReady = githubIntegration.canCreatePr && !githubIntegration.loading
    const preferencesInitializedRef = useRef(false)
    const agentPreferencesRef = useRef(agentPreferences)
    const [codexCatalog, setCodexCatalog] = useState<CodexModelCatalog>(() => ({
        models: FALLBACK_CODEX_MODELS,
        defaultModelId: FALLBACK_CODEX_MODELS[0]?.id ?? ''
    }))
    const codexModelIds = useMemo(() => codexCatalog.models.map(meta => meta.id), [codexCatalog.models])
    const defaultCodexModelId = codexCatalog.defaultModelId
    const selectedEpic = useMemo(() => (epicId ? epics.find(epic => epic.id === epicId) ?? null : null), [epics, epicId])
    const normalizedAgentTypes = useMemo<AgentType[]>(
        () => (multiAgentMode ? normalizeAllocations(multiAgentAllocations) : []),
        [multiAgentMode, multiAgentAllocations]
    )
    const totalMultiAgentCount = multiAgentMode ? normalizedAgentTypes.length : 0
    const multiAgentSummaryLabel = useMemo(() => {
        const parts: string[] = []
        MULTI_AGENT_TYPES.forEach(agent => {
            const count = multiAgentAllocations[agent]
            if (count && count > 0) {
                parts.push(`${count}x ${displayNameForAgent(agent)}`)
            }
        })
        return parts.length > 0 ? parts.join(', ') : 'Multiple agents'
    }, [multiAgentAllocations])
    const resetMultiAgentSelections = useCallback(() => {
        setMultiAgentMode(false)
        setMultiAgentAllocations({})
    }, [])

    const isBranchError = isBranchValidationError(validationError)
    const branchError = isBranchError ? validationError : undefined
    const nameError = isBranchError ? '' : validationError

    const updateManualPrompt = useCallback(
        (value: string) => {
            setManualPromptDraft(value)
            setTaskContent(value)
            onPromptChange?.(value)
            if (!wasEditedRef.current && value.trim()) {
                const derivedName = promptToSessionName(value)
                setName(derivedName)
            }
        },
        [onPromptChange]
    )

    const handlePromptSourceChange = useCallback(
        (next: 'custom' | 'github_issue' | 'github_pull_request') => {
            if (next === promptSource) {
                return
            }
            if ((next === 'github_issue' || next === 'github_pull_request') && !githubPromptReady) {
                return
            }

            if (next === 'github_issue') {
                setManualPromptDraft(taskContent)
                setPromptSource('github_issue')
                if (githubIssueSelection) {
                    setTaskContent(githubIssueSelection.prompt)
                } else {
                    setTaskContent('')
                }
            } else if (next === 'github_pull_request') {
                setManualPromptDraft(taskContent)
                setPromptSource('github_pull_request')
                if (githubPrSelection) {
                    setTaskContent(githubPrSelection.prompt)
                } else {
                    setTaskContent('')
                }
            } else {
                setPromptSource('custom')
                setGithubIssueLoading(false)
                setGithubPrLoading(false)
                setTaskContent(manualPromptDraft)
                onPromptChange?.(manualPromptDraft)
            }
            setValidationError('')
        },
        [promptSource, githubPromptReady, taskContent, githubIssueSelection, githubPrSelection, manualPromptDraft, onPromptChange]
    )

    const handleVersionSelect = useCallback((key: string) => {
        if (key === 'multi') {
            if (!multiAgentMode) {
                setMultiAgentMode(true)
            }
            setMultiAgentAllocations(prev => {
                if (sumAllocations(prev) > 0 || agentType === 'terminal') {
                    return prev
                }
                return { ...prev, [agentType]: 1 }
            })
            return
        }

        const parsed = parseInt(key, 10)
        const nextCount = Number.isNaN(parsed) ? 1 : Math.max(1, Math.min(MAX_VERSION_COUNT, parsed))
        resetMultiAgentSelections()
        setVersionCount(nextCount)
    }, [agentType, multiAgentMode, resetMultiAgentSelections])

    const handleAgentToggle = useCallback((agent: AgentType, enabled: boolean) => {
        if (agent === 'terminal') {
            return
        }
        setMultiAgentAllocations(prev => {
            if (!enabled) {
                if (!prev[agent]) {
                    return prev
                }
                const next = { ...prev }
                delete next[agent]
                return next
            }

            const otherTotal = sumAllocations(prev)
            const availableSlots = MAX_VERSION_COUNT - otherTotal
            if (availableSlots <= 0) {
                return prev
            }
            return { ...prev, [agent]: 1 }
        })
    }, [])

    const handleAgentCountChange = useCallback((agent: AgentType, requestedCount: number) => {
        if (agent === 'terminal') {
            return
        }
        setMultiAgentAllocations(prev => {
            if (!prev[agent]) {
                return prev
            }
            const otherTotal = sumAllocations(prev, agent)
            const allowed = Math.max(0, Math.min(requestedCount, MAX_VERSION_COUNT - otherTotal))
            if (allowed <= 0) {
                const next = { ...prev }
                delete next[agent]
                return next
            }
            if (prev[agent] === allowed) {
                return prev
            }
            return { ...prev, [agent]: allowed }
        })
    }, [])

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

    const persistAgentPreferences = useCallback(async (agent: AgentType, preferences: AgentPreferenceState) => {
        try {
            const normalizedModel = preferences.model?.trim() || ''
            const normalizedReasoning = preferences.reasoningEffort?.trim() || ''

            await invoke(TauriCommands.SetAgentPreferences, {
                agentType: agent,
                preferences: {
                    model: normalizedModel ? normalizedModel : null,
                    reasoning_effort: normalizedReasoning ? normalizedReasoning : null,
                },
            })
        } catch (error) {
            logger.warn('[NewSessionModal] Failed to persist agent preferences', agent, error)
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

    const handleAgentPreferenceChange = useCallback(
        (agent: AgentType, field: AgentPreferenceField, value: string) => {
            setAgentPreferences(prev => {
                const current = prev[agent] ?? { model: '', reasoningEffort: '' }
                const updated = {
                    ...current,
                    [field]: value,
                }

                if (agent === 'codex' && field === 'model') {
                    const meta = getCodexModelMetadata(value, codexCatalog.models)
                    const supportedEfforts = meta?.reasoningOptions?.map(option => option.id) ?? []
                    if (supportedEfforts.length > 0 && !supportedEfforts.includes(updated.reasoningEffort ?? '')) {
                        updated.reasoningEffort = meta?.defaultReasoning ?? supportedEfforts[0]
                    }
                }

                if (agent === 'codex' && field === 'reasoningEffort') {
                    const modelId = (prev.codex?.model ?? updated.model) || ''
                    const meta = getCodexModelMetadata(modelId, codexCatalog.models)
                    const supportedEfforts = meta?.reasoningOptions?.map(option => option.id) ?? []
                    if (supportedEfforts.length > 0 && !supportedEfforts.includes(value)) {
                        return prev
                    }
                }

                const nextState = {
                    ...prev,
                    [agent]: updated,
                }
                void persistAgentPreferences(agent, nextState[agent])
                return nextState
            })
        },
        [persistAgentPreferences, codexCatalog.models]
    )

    useEffect(() => {
        agentPreferencesRef.current = agentPreferences
    }, [agentPreferences])

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
        if (!SESSION_NAME_ALLOWED_PATTERN.test(sessionName)) {
            return 'Agent name can only contain letters, numbers, hyphens, underscores, and spaces'
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
        // Generate name from prompt if available, fallback to Docker style
        let finalName = currentValue.trim() || (taskContent.trim() ? promptToSessionName(taskContent) : generateDockerStyleName())
        
        const error = validateSessionName(finalName)
        if (error) {
            setValidationError(error)
            return
        }
        
        const issuePrompt = githubIssueSelection?.prompt ?? ''
        const prPrompt = githubPrSelection?.prompt ?? ''
        const currentPrompt =
            promptSource === 'github_issue' 
                ? issuePrompt 
                : promptSource === 'github_pull_request'
                    ? prPrompt
                    : taskContent

        if (promptSource === 'github_issue' && !githubIssueSelection) {
            setValidationError('Select a GitHub issue to continue')
            return
        }

        if (promptSource === 'github_pull_request' && !githubPrSelection) {
            setValidationError('Select a GitHub pull request to continue')
            return
        }

        // Validate that base branch is selected
        if (!createAsDraft && !baseBranch) {
            setValidationError('Please select a base branch')
            return
        }
        
        // Validate spec content if creating as spec
         if (createAsDraft && !currentPrompt.trim()) {
             setValidationError('Please enter spec content')
             return
         }
        if (!createAsDraft && multiAgentMode && normalizedAgentTypes.length === 0) {
            setValidationError('Select at least one agent to continue')
            return
        }

        // Replace spaces with underscores for the actual session name
        finalName = finalName.replace(/ /g, '_')
        
        const userEdited = wasEditedRef.current || (
            initialGeneratedNameRef.current && currentValue.trim() !== initialGeneratedNameRef.current
        )

        try {
            setCreating(true)

            const useMultiAgentTypes = !createAsDraft && multiAgentMode && normalizedAgentTypes.length > 0
            const agentTypesPayload = useMultiAgentTypes ? normalizedAgentTypes : undefined
            const effectiveVersionCount = createAsDraft
                ? 1
                : useMultiAgentTypes
                    ? normalizedAgentTypes.length
                    : versionCount
            const primaryAgentType = useMultiAgentTypes
                ? (normalizedAgentTypes[0] ?? agentType)
                : agentType

            const effectiveUseExistingBranch = useExistingBranch
            const effectiveCustomBranch = useExistingBranch
                ? baseBranch
                : customBranch.trim() || undefined

            const prInfo = promptSource === 'github_pull_request' && githubPrSelection
                ? { prNumber: githubPrSelection.details.number, prUrl: githubPrSelection.details.url }
                : {}

            const createData: CreateSessionPayload = {
                name: finalName,
                prompt: createAsDraft ? undefined : (currentPrompt || undefined),
                baseBranch: createAsDraft ? '' : baseBranch,
                customBranch: effectiveCustomBranch,
                useExistingBranch: effectiveUseExistingBranch,
                syncWithOrigin: useExistingBranch,
                userEditedName: !!userEdited,
                isSpec: createAsDraft,
                draftContent: createAsDraft ? currentPrompt : undefined,
                versionCount: effectiveVersionCount,
                agentType: primaryAgentType,
                skipPermissions: createAsDraft ? skipPermissions : undefined,
                epicId,
                ...prInfo,
            }
            if (agentTypesPayload) {
                createData.agentTypes = agentTypesPayload
            }

            logger.info('[NewSessionModal] Creating session with data:', {
                ...createData,
                createAsDraft,
                taskContent: taskContent ? taskContent.substring(0, 100) + (taskContent.length > 100 ? '...' : '') : undefined,
                promptWillBe: createData.prompt ? createData.prompt.substring(0, 100) + (createData.prompt.length > 100 ? '...' : '') : undefined
            })
            await Promise.resolve(onCreate(createData))
        } catch (e) {
            let errorMessage = 'Unknown error occurred'
            if (e instanceof Error) {
                errorMessage = e.message
            } else if (typeof e === 'string') {
                errorMessage = e
            } else if (e && typeof e === 'object') {
                const err = e as { data?: { message?: string }; message?: string }
                errorMessage = err.data?.message ?? err.message ?? errorMessage
            }
            if (isBranchValidationError(errorMessage)) {
                logger.warn(`Failed to create session (validation): ${name}`, e)
            } else {
                logger.error(`Failed to create session: ${name}`, e)
            }
            setValidationError(errorMessage)
            setCreating(false)
        }
    }, [creating, name, taskContent, baseBranch, customBranch, useExistingBranch, onCreate, validateSessionName, createAsDraft, versionCount, agentType, skipPermissions, epicId, promptSource, githubIssueSelection, githubPrSelection, multiAgentMode, normalizedAgentTypes])

    // Keep ref in sync immediately on render to avoid stale closures in tests
    createRef.current = () => { void handleCreate() }

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

                const preferenceResults = await Promise.all(
                    AGENT_TYPES.map(async agent => {
                        try {
                            const result = await invoke<{ model?: string | null; reasoning_effort?: string | null }>(
                                TauriCommands.GetAgentPreferences,
                                { agentType: agent }
                            )
                            return result ?? {}
                        } catch (error) {
                            logger.warn('[NewSessionModal] Failed to load agent preferences', agent, error)
                            return {}
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

                setAgentPreferences(() => {
                    const next = createEmptyPreferenceState()
                    AGENT_TYPES.forEach((agent, index) => {
                        const raw = preferenceResults[index] || {}
                        next[agent] = {
                            model: raw.model ?? '',
                            reasoningEffort: raw.reasoning_effort ?? '',
                        }
                    })
                    return next
                })
            } catch (error) {
                if (!cancelled) {
                    logger.warn('[NewSessionModal] Failed to load agent defaults', error)
                    setAgentEnvVars(createEmptyEnvVarState())
                    setAgentCliArgs(createEmptyCliArgsState())
                    setAgentPreferences(createEmptyPreferenceState())
                }
            } finally {
                if (!cancelled) {
                    setAgentConfigLoading(false)
                    preferencesInitializedRef.current = true
                }
            }
        }

        void loadAgentDefaults()

        return () => {
            cancelled = true
        }
    }, [open])

    useEffect(() => {
        if (!open) {
            return
        }

        let cancelled = false

        const loadCatalog = async () => {
            try {
                const catalog = await loadCodexModelCatalog()
                if (!cancelled) {
                    setCodexCatalog(catalog)
                }
            } catch (error) {
                logger.warn('[NewSessionModal] Failed to refresh Codex model catalog', error)
            }
        }

        void loadCatalog()

        return () => {
            cancelled = true
        }
    }, [open])

    useEffect(() => {
        if (agentType !== 'codex') {
            return
        }
        if (agentConfigLoading) {
            return
        }
        if (!preferencesInitializedRef.current) {
            return
        }

        const currentPrefs = agentPreferencesRef.current.codex ?? { model: '', reasoningEffort: '' }

        const currentModel = currentPrefs.model?.trim() ?? ''
        if (!currentModel || !codexModelIds.includes(currentModel)) {
            if (defaultCodexModelId && defaultCodexModelId !== currentModel) {
                handleAgentPreferenceChange('codex', 'model', defaultCodexModelId)
                return
            }
        }

        const activeModel = currentModel && codexModelIds.includes(currentModel)
            ? currentModel
            : defaultCodexModelId
        const modelMeta = activeModel ? getCodexModelMetadata(activeModel, codexCatalog.models) : undefined
        const supportedEfforts = modelMeta?.reasoningOptions?.map(option => option.id) ?? []
        const currentReasoning = currentPrefs.reasoningEffort?.trim() ?? ''

        if (supportedEfforts.length === 0) {
            if (currentReasoning) {
                handleAgentPreferenceChange('codex', 'reasoningEffort', '')
            }
            return
        }

        if (!supportedEfforts.includes(currentReasoning)) {
            const fallbackReasoning = modelMeta?.defaultReasoning ?? supportedEfforts[0]
            handleAgentPreferenceChange('codex', 'reasoningEffort', fallbackReasoning)
        }
    }, [agentType, agentPreferences, agentConfigLoading, handleAgentPreferenceChange, codexModelIds, defaultCodexModelId, codexCatalog.models])

    // Register/unregister modal with context using layout effect to minimize timing gaps
    useLayoutEffect(() => {
        if (open) {
            registerModal('NewSessionModal')
        } else {
            unregisterModal('NewSessionModal')
        }
    }, [open, registerModal, unregisterModal])

    useEffect(() => {
        if (!open) {
            resetMultiAgentSelections()
        }
    }, [open, resetMultiAgentSelections])

    useEffect(() => {
        if (!open) {
            return
        }
        ensureEpicsLoaded().catch((err) => {
            logger.warn('[NewSessionModal] Failed to load epics:', err)
        })
    }, [open, ensureEpicsLoaded])

    useEffect(() => {
        if (createAsDraft || agentType === 'terminal') {
            resetMultiAgentSelections()
        }
    }, [createAsDraft, agentType, resetMultiAgentSelections])

    useLayoutEffect(() => {
        const openedThisRender = open && !lastOpenStateRef.current
        const closedThisRender = !open && lastOpenStateRef.current
        lastOpenStateRef.current = open

        if (open) {
            if (openedThisRender) {
                logger.info('[NewSessionModal] Modal opened with:', {
                    initialIsDraft,
                    isPrefillPending,
                    hasPrefillData,
                    currentCreateAsDraft: createAsDraft,
                    wasOpen: wasOpenRef.current,
                    lastInitialIsDraft: lastInitialIsDraftRef.current
                })
            }
            
            setCreating(false)
            // Generate initial name - prefer prompt-based if cached prompt exists, fallback to Docker style
            const gen = cachedPrompt?.trim()
                ? promptToSessionName(cachedPrompt)
                : generateDockerStyleName()
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
                setPromptSource('custom')
                setGithubIssueSelection(null)
                setGithubPrSelection(null)
                setGithubIssueLoading(false)
                setGithubPrLoading(false)
                setManualPromptDraft(cachedPrompt)
                setTaskContent(cachedPrompt)
                setValidationError('')
                setCreateAsDraft(initialIsDraft)
                setCustomBranch('')
                setUseExistingBranch(false)
                setNameLocked(false)
                setOriginalSpecName('')
                setEpicId(null)
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
                if (openedThisRender || initialIsDraftChanged) {
                    logger.info('[NewSessionModal] Skipping full state reset - reason: prefill pending or has data or modal was already open and initialIsDraft unchanged')
                }
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

            if (focusTimeoutRef.current !== undefined) {
                clearTimeout(focusTimeoutRef.current)
                focusTimeoutRef.current = undefined
            }
            if (!hasFocusedDuringOpenRef.current) {
                focusTimeoutRef.current = window.setTimeout(() => {
                    hasFocusedDuringOpenRef.current = true
                    if (markdownEditorRef.current) {
                        markdownEditorRef.current.focusEnd()
                    } else if (nameInputRef.current) {
                        nameInputRef.current.focus()
                        nameInputRef.current.select()
                    }
                }, 100)
            }
        } else {
            setIgnorePersistedAgentType(hasAgentOverrideRef.current)
            if (closedThisRender) {
                logger.info(`[NewSessionModal] Modal closed - resetting all state except taskContent ${JSON.stringify({
                    lastAgentType: lastAgentTypeRef.current,
                    hasOverride: hasAgentOverrideRef.current
                })}`)
            }
            setIsPrefillPending(false)
            setHasPrefillData(false)
            setCreateAsDraft(false)
            setCustomBranch('')
            setUseExistingBranch(false)
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
            if (focusTimeoutRef.current !== undefined) {
                clearTimeout(focusTimeoutRef.current)
                focusTimeoutRef.current = undefined
            }
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
            const epicIdFromDraft: string | null | undefined = detail.epicId

            if (nameFromDraft) {
                logger.info('[NewSessionModal] Setting name from prefill:', nameFromDraft)
                setName(nameFromDraft)
                wasEditedRef.current = true
                setWasEdited(true)
                setNameLocked(!!lockName)
            }
            if (typeof taskContentFromDraft === 'string') {
                logger.info('[NewSessionModal] Setting agent content from prefill:', taskContentFromDraft.substring(0, 100), '...')
                setPromptSource('custom')
                setGithubIssueSelection(null)
                setGithubPrSelection(null)
                setGithubIssueLoading(false)
                setGithubPrLoading(false)
                setManualPromptDraft(taskContentFromDraft)
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
            if (epicIdFromDraft !== undefined) {
                logger.info('[NewSessionModal] Setting epic from prefill:', epicIdFromDraft)
                setEpicId(epicIdFromDraft)
            }
            if (fromDraft) {
                 logger.info('[NewSessionModal] Running from existing spec - forcing createAsDraft to false')
                 setCreateAsDraft(false)
             }

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

                const availableAgents = AGENT_TYPES.filter(agent => agent === 'terminal' || isAvailable(agent))
                if (availableAgents.length === 0) return

                const currentIndex = availableAgents.indexOf(agentType)
                let nextIndex: number

                if (e.key === 'ArrowUp') {
                    nextIndex = currentIndex === 0 ? availableAgents.length - 1 : currentIndex - 1
                } else {
                    nextIndex = currentIndex === availableAgents.length - 1 ? 0 : currentIndex + 1
                }

                handleAgentTypeChange(availableAgents[nextIndex])
            } else if (
                agentType === 'codex' &&
                (e.key === 'ArrowLeft' || e.key === 'ArrowRight') &&
                e.metaKey
            ) {
                e.preventDefault()
                e.stopPropagation()
                if (typeof e.stopImmediatePropagation === 'function') {
                    e.stopImmediatePropagation()
                }

                if (codexModelIds.length === 0) {
                    return
                }

                const currentPrefs = agentPreferencesRef.current.codex ?? { model: '', reasoningEffort: '' }
                const currentModel = currentPrefs.model?.trim() || defaultCodexModelId || codexModelIds[0] || ''
                const modelMeta = currentModel ? getCodexModelMetadata(currentModel, codexCatalog.models) : undefined
                const reasoningOptions = modelMeta?.reasoningOptions?.map(option => option.id) ?? []
                if (reasoningOptions.length === 0) {
                    return
                }

                const currentReasoning = currentPrefs.reasoningEffort?.trim() ?? ''
                let currentIndex = reasoningOptions.indexOf(currentReasoning)
                if (currentIndex === -1) {
                    currentIndex = e.key === 'ArrowLeft' ? reasoningOptions.length - 1 : 0
                }

                const nextIndex = e.key === 'ArrowLeft'
                    ? (currentIndex === 0 ? reasoningOptions.length - 1 : currentIndex - 1)
                    : (currentIndex === reasoningOptions.length - 1 ? 0 : currentIndex + 1)

                const nextEffort = reasoningOptions[nextIndex]
                if (nextEffort !== currentReasoning) {
                    handleAgentPreferenceChange('codex', 'reasoningEffort', nextEffort)
                }
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
    }, [open, onClose, agentType, handleAgentTypeChange, handleAgentPreferenceChange, isAvailable, codexModelIds, codexCatalog, defaultCodexModelId])

    if (!open) return null

    const canStartAgent = multiAgentMode
        ? normalizedAgentTypes.length > 0 && normalizedAgentTypes.every(selectedAgent => selectedAgent === 'terminal' || isAvailable(selectedAgent))
        : agentType === 'terminal' || isAvailable(agentType)
    const hasSpecContent =
        promptSource === 'github_issue'
            ? Boolean(githubIssueSelection?.prompt.trim())
            : promptSource === 'github_pull_request'
                ? Boolean(githubPrSelection?.prompt.trim())
                : Boolean(taskContent.trim())
    const requiresIssueSelection = promptSource === 'github_issue' && !githubIssueSelection
    const requiresPrSelection = promptSource === 'github_pull_request' && !githubPrSelection
    const multiAgentSelectionInvalid = !createAsDraft && multiAgentMode && normalizedAgentTypes.length === 0
    const isStartDisabled =
        !name.trim() ||
        (!createAsDraft && !baseBranch) ||
        creating ||
        githubIssueLoading ||
        githubPrLoading ||
        (createAsDraft && !hasSpecContent) ||
        multiAgentSelectionInvalid ||
        (!createAsDraft && !canStartAgent) ||
        requiresIssueSelection ||
        requiresPrSelection

    const getStartButtonTitle = () => {
        if (createAsDraft) {
            return "Create spec (Cmd+Enter)"
        }
        if (githubIssueLoading) {
            return 'Fetching issue details...'
        }
        if (githubPrLoading) {
            return 'Fetching pull request details...'
        }
        if (requiresIssueSelection) {
            return 'Select a GitHub issue to generate a prompt'
        }
        if (requiresPrSelection) {
            return 'Select a GitHub pull request to generate a prompt'
        }
        if (multiAgentMode && normalizedAgentTypes.length === 0) {
            return 'Select at least one agent to continue'
        }
        if (!canStartAgent) {
            return multiAgentMode
                ? 'One or more selected agents are not installed. Please install them to continue.'
                : `${agentType} is not installed. Please install it to use this agent.`
        }
        return "Start agent (Cmd+Enter)"
    }

    const footer = (
        <>
            {!createAsDraft && agentType !== 'terminal' && multiAgentMode && (
                <MultiAgentAllocationDropdown
                    allocations={multiAgentAllocations}
                    selectableAgents={MULTI_AGENT_TYPES}
                    totalCount={totalMultiAgentCount}
                    maxCount={MAX_VERSION_COUNT}
                    summaryLabel={multiAgentSummaryLabel}
                    isAgentAvailable={isAvailable}
                    onToggleAgent={handleAgentToggle}
                    onChangeCount={handleAgentCountChange}
                />
            )}
            {!createAsDraft && agentType !== 'terminal' && (
                <Dropdown
                  open={showVersionMenu}
                  onOpenChange={setShowVersionMenu}
                  items={VERSION_DROPDOWN_ITEMS}
                  selectedKey={multiAgentMode ? 'multi' : String(versionCount)}
                  align="right"
                  onSelect={handleVersionSelect}
                  menuTestId="version-selector-menu"
                >
                  {({ open, toggle }) => (
                    <button
                      type="button"
                      data-testid="version-selector"
                      onClick={toggle}
                      className="px-2 h-9 rounded inline-flex items-center gap-2 hover:opacity-90"
                      style={{
                        backgroundColor: open ? 'var(--color-bg-hover)' : 'var(--color-bg-elevated)',
                        color: 'var(--color-text-primary)',
                        border: `1px solid ${open ? 'var(--color-border-default)' : 'var(--color-border-subtle)'}`,
                      }}
                      title={multiAgentMode ? 'Configure multiple agents' : 'Number of parallel versions'}
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" style={{ display: 'block', verticalAlign: 'middle' }}>
                        <path d="M12 2L3 6l9 4 9-4-9-4z" fill={'var(--color-text-primary)'} fillOpacity={0.9}/>
                        <path d="M3 10l9 4 9-4" stroke={'var(--color-text-primary)'} strokeOpacity={0.5} strokeWidth={1.2}/>
                        <path d="M3 14l9 4 9-4" stroke={'var(--color-text-primary)'} strokeOpacity={0.35} strokeWidth={1.2}/>
                      </svg>
                      <span style={{ lineHeight: 1 }}>
                        {multiAgentMode ? multiAgentSummaryLabel : `${versionCount}x`}
                      </span>
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
                style={{ backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)', border: `1px solid ${'var(--color-border-subtle)'}` }}
                title="Cancel (Esc)"
            >
                Cancel
                <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
            </button>
            <button
                onClick={() => { void handleCreate() }}
                disabled={isStartDisabled}
                className={`px-3 h-9 disabled:cursor-not-allowed rounded text-white group relative inline-flex items-center gap-2 ${isStartDisabled ? 'opacity-60' : 'hover:opacity-90'}`}
                style={{
                    backgroundColor: createAsDraft ? 'var(--color-accent-amber)' : 'var(--color-accent-blue)',
                    opacity: creating ? 0.9 : 1
                }}
                title={getStartButtonTitle()}
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
	                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
	                    <div>
	                        <label className="block text-sm text-secondary mb-1">Agent name</label>
	                        <input
	                            ref={nameInputRef}
	                            value={name}
	                            onChange={handleNameChange}
                            onFocus={() => { setWasEdited(true); wasEditedRef.current = true }}
                            onKeyDown={() => { setWasEdited(true); wasEditedRef.current = true }}
                            onInput={() => { setWasEdited(true); wasEditedRef.current = true }}
                            className={`w-full bg-elevated text-primary rounded px-3 py-2 border ${
                                nameError ? 'border-status-error' : 'border-subtle'
                            }`}
                            placeholder="eager_cosmos"
                            disabled={nameLocked}
                        />
                        {nameError && (
                            <div className="flex items-start gap-2 mt-1">
                                <svg className="w-4 h-4 text-status-error mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                </svg>
                                <p className="text-xs text-status-error">{nameError}</p>
                            </div>
                        )}
                        {originalSpecName && (
                            <div className="flex items-center justify-between mt-2 px-2 py-1 rounded text-xs" style={{ backgroundColor: 'var(--color-bg-elevated)', border: `1px solid ${'var(--color-border-subtle)'}` }}>
                                <div className="flex items-center gap-2">
                                    <svg className="w-3 h-3 flex-shrink-0" style={{ color: 'var(--color-accent-blue)' }} fill="currentColor" viewBox="0 0 20 20">
                                        <path fillRule="evenodd" d="M4 3a2 2 0 00-2 2v1.5h16V5a2 2 0 00-2-2H4zm14 6H2v5a2 2 0 002 2h12a2 2 0 002-2V9zM2 7h16v1H2V7z" clipRule="evenodd" />
                                    </svg>
                                    <span style={{ color: 'var(--color-text-secondary)' }}>From spec: <span style={{ color: 'var(--color-text-primary)' }}>{originalSpecName}</span></span>
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
                                        style={{ backgroundColor: 'var(--color-accent-blue-bg)', color: 'var(--color-accent-blue)' }}
                                        title="Reset to original spec name"
                                    >
                                        Reset
                                    </button>
                                )}
                            </div>
	                        )}
	                    </div>

	                    <div>
	                        <label className="block text-sm text-secondary mb-1">Epic</label>
	                        <EpicSelect
	                            value={selectedEpic}
	                            onChange={setEpicId}
	                            variant="field"
	                            showDeleteButton
	                        />
	                    </div>
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
                            style={{ color: 'var(--color-accent-cyan)' }}
                        />
                        <label htmlFor="createAsDraft" className="text-sm text-secondary">Create as spec (no agent will start)</label>
                    </div>

                    <div className="flex flex-col flex-1 min-h-0">
                        <div className="flex items-center justify-between mb-2">
                            <label className="block text-sm text-secondary">
                                {createAsDraft ? 'Spec content' : 'Initial prompt (optional)'}
                            </label>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    onClick={() => handlePromptSourceChange('custom')}
                                    aria-pressed={promptSource === 'custom'}
                                    className="px-3 py-1 text-xs rounded transition-colors"
                                    style={{
                                        backgroundColor:
                                            promptSource === 'custom'
                                                ? 'var(--color-bg-elevated)'
                                                : 'var(--color-bg-primary)',
                                        color: 'var(--color-text-primary)',
                                        border: `1px solid ${
                                            promptSource === 'custom'
                                                ? 'var(--color-accent-blue)'
                                                : 'var(--color-border-subtle)'
                                        }`,
                                    }}
                                >
                                    Custom prompt
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (githubPromptReady) {
                                            handlePromptSourceChange('github_issue')
                                        }
                                    }}
                                    title={
                                        githubPromptReady
                                            ? 'Use a GitHub issue as the agent prompt'
                                            : 'Connect GitHub to enable GitHub issue prompts'
                                    }
                                    aria-pressed={promptSource === 'github_issue'}
                                    disabled={!githubPromptReady}
                                    className="px-3 py-1 text-xs rounded transition-colors"
                                    style={{
                                        backgroundColor:
                                            promptSource === 'github_issue'
                                                ? 'var(--color-bg-elevated)'
                                                : 'var(--color-bg-primary)',
                                        color: githubPromptReady
                                            ? 'var(--color-text-primary)'
                                            : 'var(--color-text-secondary)',
                                        border: `1px solid ${
                                            promptSource === 'github_issue'
                                                ? 'var(--color-accent-blue)'
                                                : 'var(--color-border-subtle)'
                                        }`,
                                        opacity: githubPromptReady ? 1 : 0.6,
                                        cursor: githubPromptReady ? 'pointer' : 'not-allowed',
                                    }}
                                >
                                    GitHub issue
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        if (githubPromptReady) {
                                            handlePromptSourceChange('github_pull_request')
                                        }
                                    }}
                                    title={
                                        githubPromptReady
                                            ? 'Use a GitHub pull request as the agent prompt'
                                            : 'Connect GitHub to enable GitHub PR prompts'
                                    }
                                    aria-pressed={promptSource === 'github_pull_request'}
                                    disabled={!githubPromptReady}
                                    className="px-3 py-1 text-xs rounded transition-colors"
                                    style={{
                                        backgroundColor:
                                            promptSource === 'github_pull_request'
                                                ? 'var(--color-bg-elevated)'
                                                : 'var(--color-bg-primary)',
                                        color: githubPromptReady
                                            ? 'var(--color-text-primary)'
                                            : 'var(--color-text-secondary)',
                                        border: `1px solid ${
                                            promptSource === 'github_pull_request'
                                                ? 'var(--color-accent-blue)'
                                                : 'var(--color-border-subtle)'
                                        }`,
                                        opacity: githubPromptReady ? 1 : 0.6,
                                        cursor: githubPromptReady ? 'pointer' : 'not-allowed',
                                    }}
                                >
                                    GitHub PR
                                </button>
                            </div>
                        </div>
                        <div className="flex-1 min-h-0 overflow-hidden">
                            {promptSource === 'custom' ? (
                                <div className="h-full" data-testid="session-task-editor">
                                    <MarkdownEditor
                                        ref={markdownEditorRef}
                                        value={taskContent}
                                        onChange={value => {
                                            updateManualPrompt(value)
                                            if (validationError) {
                                                setValidationError('')
                                            }
                                        }}
                                        placeholder={
                                            createAsDraft
                                                ? 'Enter spec content in markdown...'
                                                : 'Describe the agent for the Claude session'
                                        }
                                        className="h-full"
                                        fileReferenceProvider={projectFileIndex}
                                    />
                                </div>
                            ) : promptSource === 'github_issue' ? (
                                <GitHubIssuePromptSection
                                    selection={githubIssueSelection}
                                    onIssueLoaded={selection => {
                                        setGithubIssueSelection(selection)
                                        setTaskContent(selection.prompt)
                                        onPromptChange?.(selection.prompt)
                                        if (!wasEditedRef.current) {
                                            const derivedName = titleToSessionName(
                                                selection.details.title,
                                                selection.details.number
                                            )
                                            if (derivedName) {
                                                setName(derivedName)
                                            }
                                        }
                                        if (validationError) {
                                            setValidationError('')
                                        }
                                    }}
                                    onClearSelection={() => {
                                        setGithubIssueSelection(null)
                                        setTaskContent('')
                                        onPromptChange?.('')
                                    }}
                                    onLoadingChange={setGithubIssueLoading}
                                />
                            ) : (
                                <GitHubPrPromptSection
                                    selection={githubPrSelection}
                                    onPrLoaded={selection => {
                                        setGithubPrSelection(selection)
                                        setTaskContent(selection.prompt)
                                        onPromptChange?.(selection.prompt)
                                        if (!wasEditedRef.current) {
                                            const derivedName = titleToSessionName(
                                                selection.details.title,
                                                selection.details.number
                                            )
                                            if (derivedName) {
                                                setName(derivedName)
                                            }
                                        }
                                        if (validationError) {
                                            setValidationError('')
                                        }
                                    }}
                                    onClearSelection={() => {
                                        setGithubPrSelection(null)
                                        setTaskContent('')
                                        onPromptChange?.('')
                                    }}
                                    onLoadingChange={setGithubPrLoading}
                                />
                            )}
                        </div>
                        <p className="text-xs text-tertiary mt-1">
                            {promptSource === 'github_issue'
                                ? 'Select an issue to pull its description and comments into the agent prompt.'
                                : promptSource === 'github_pull_request'
                                    ? 'Select a pull request to pull its description and comments into the agent prompt. The session will start on the PR branch.'
                                    : createAsDraft
                                    ? (
                                        <>
                                            <svg className="inline-block w-3 h-3 mr-1" fill="currentColor" viewBox="0 0 20 20">
                                                <path
                                                    fillRule="evenodd"
                                                    d="M18 10a8 8 0 11-16 0 8 8 0 0116 0zm-7-4a1 1 0 11-2 0 1 1 0 012 0zM9 9a1 1 0 000 2v3a1 1 0 001 1h1a1 1 0 100-2v-3a1 1 0 00-1-1H9z"
                                                    clipRule="evenodd"
                                                />
                                            </svg>
                                            Specs are saved for later. You can start them when ready. Type @ to reference project files.
                                        </>
                                    )
                                    : 'Type @ to reference project files.'}
                        </p>
                    </div>

                    {repositoryIsEmpty && !createAsDraft && (
                        <div className="bg-warning-bg border border-warning rounded-lg p-3 flex items-start gap-2">
                            <svg className="w-5 h-5 text-warning mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <div className="text-sm text-warning-light">
                                <p className="font-medium mb-1">New repository detected</p>
                                <p className="text-xs text-warning-lighter">
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
                                onUseExistingBranchChange={(useExisting) => {
                                    setUseExistingBranch(useExisting)
                                    if (validationError) {
                                        setValidationError('')
                                    }
                                }}
                                initialBaseBranch={baseBranch}
                                initialAgentType={agentType}
                                initialSkipPermissions={skipPermissions}
                                initialCustomBranch={customBranch}
                                initialUseExistingBranch={useExistingBranch}
                                codexModel={agentPreferences.codex?.model}
                                codexModelOptions={codexModelIds}
                                codexModels={codexCatalog.models}
                                onCodexModelChange={(model) => handleAgentPreferenceChange('codex', 'model', model)}
                                codexReasoningEffort={agentPreferences.codex?.reasoningEffort}
                                onCodexReasoningChange={(effort) => handleAgentPreferenceChange('codex', 'reasoningEffort', effort)}
                                sessionName={name}
                                ignorePersistedAgentType={ignorePersistedAgentType}
                                agentControlsDisabled={multiAgentMode}
                                branchError={branchError}
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
                                <div className="bg-info-bg border border-info rounded-lg p-3 flex items-start gap-2">
                                    <svg className="w-5 h-5 text-info mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                    </svg>
                                    <div className="text-sm text-info-light">
                                        <p className="font-medium mb-1">Terminal-only mode</p>
                                        <p className="text-xs text-info-lighter">
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
