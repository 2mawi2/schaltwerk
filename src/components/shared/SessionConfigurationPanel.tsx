import { useState, useEffect, useCallback, useRef } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import React from 'react'
import { BranchAutocomplete } from '../inputs/BranchAutocomplete'
import { ModelSelector } from '../inputs/ModelSelector'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { AgentType, AGENT_TYPES } from '../../types/session'

interface SessionConfigurationPanelProps {
    variant?: 'modal' | 'compact'
    onBaseBranchChange?: (branch: string) => void
    onAgentTypeChange?: (agentType: AgentType) => void
    onSkipPermissionsChange?: (enabled: boolean) => void
    initialBaseBranch?: string
    initialAgentType?: AgentType
    initialSkipPermissions?: boolean
    disabled?: boolean
    hideLabels?: boolean
}

export interface SessionConfiguration {
    baseBranch: string
    agentType: AgentType
    skipPermissions: boolean
    isValid: boolean
}

export function SessionConfigurationPanel({
    variant = 'modal',
    onBaseBranchChange,
    onAgentTypeChange,
    onSkipPermissionsChange,
    initialBaseBranch = '',
    initialAgentType = 'claude',
    initialSkipPermissions = false,
    disabled = false,
    hideLabels = false
}: SessionConfigurationPanelProps) {
    const [baseBranch, setBaseBranch] = useState(initialBaseBranch)
    const [branches, setBranches] = useState<string[]>([])
    const [loadingBranches, setLoadingBranches] = useState(false)
    const [isValidBranch, setIsValidBranch] = useState(true)
    const [agentType, setAgentType] = useState<AgentType>(initialAgentType)
    const [skipPermissions, setSkipPermissions] = useState(initialSkipPermissions)
    const { getSkipPermissions, setSkipPermissions: saveSkipPermissions, getAgentType, setAgentType: saveAgentType } = useClaudeSession()

    const onBaseBranchChangeRef = useRef(onBaseBranchChange)
    const onAgentTypeChangeRef = useRef(onAgentTypeChange)
    const onSkipPermissionsChangeRef = useRef(onSkipPermissionsChange)
    const baseBranchValueRef = useRef(initialBaseBranch)
    const userEditedBranchRef = useRef(false)
    const skipPermissionsTouchedRef = useRef(false)
    const agentTypeTouchedRef = useRef(false)
    const initialSkipPermissionsRef = useRef(initialSkipPermissions)
    const initialAgentTypeRef = useRef(initialAgentType)
    const getSkipPermissionsRef = useRef(getSkipPermissions)
    const getAgentTypeRef = useRef(getAgentType)
    const saveAgentTypeRef = useRef(saveAgentType)
    const prevInitialBaseBranchRef = useRef(initialBaseBranch)

    useEffect(() => { onBaseBranchChangeRef.current = onBaseBranchChange }, [onBaseBranchChange])
    useEffect(() => { onAgentTypeChangeRef.current = onAgentTypeChange }, [onAgentTypeChange])
    useEffect(() => { onSkipPermissionsChangeRef.current = onSkipPermissionsChange }, [onSkipPermissionsChange])
    useEffect(() => { getSkipPermissionsRef.current = getSkipPermissions }, [getSkipPermissions])
    useEffect(() => { getAgentTypeRef.current = getAgentType }, [getAgentType])
    useEffect(() => { saveAgentTypeRef.current = saveAgentType }, [saveAgentType])

    useEffect(() => {
        baseBranchValueRef.current = baseBranch
    }, [baseBranch])

    const loadConfiguration = useCallback(async () => {
        setLoadingBranches(true)
        try {
            const [branchList, savedDefaultBranch, gitDefaultBranch, storedSkipPerms, storedAgentType] = await Promise.all([
                invoke<string[]>(TauriCommands.ListProjectBranches),
                invoke<string | null>(TauriCommands.GetProjectDefaultBaseBranch),
                invoke<string>(TauriCommands.GetProjectDefaultBranch),
                getSkipPermissionsRef.current(),
                getAgentTypeRef.current()
            ])

            setBranches(branchList)

            const hasUserBranch = userEditedBranchRef.current || !!(baseBranchValueRef.current && baseBranchValueRef.current.trim() !== '')
            if (!hasUserBranch) {
                const defaultBranch = savedDefaultBranch || gitDefaultBranch
                if (defaultBranch) {
                    baseBranchValueRef.current = defaultBranch
                    setBaseBranch(defaultBranch)
                    onBaseBranchChangeRef.current?.(defaultBranch)
                }
            }

            if (!skipPermissionsTouchedRef.current && !initialSkipPermissionsRef.current) {
                setSkipPermissions(storedSkipPerms)
                onSkipPermissionsChangeRef.current?.(storedSkipPerms)
            }

            if (!agentTypeTouchedRef.current && initialAgentTypeRef.current === 'claude') {
                const storedAgentTypeString =
                    typeof storedAgentType === 'string' ? storedAgentType : null
                const normalizedType =
                    storedAgentTypeString && AGENT_TYPES.includes(storedAgentTypeString as AgentType)
                        ? (storedAgentTypeString as AgentType)
                        : 'claude'

                setAgentType(normalizedType)
                onAgentTypeChangeRef.current?.(normalizedType)

                if (storedAgentTypeString !== normalizedType) {
                    try {
                        await saveAgentTypeRef.current?.(normalizedType)
                    } catch (err) {
                        logger.warn('Failed to persist normalized agent type:', err)
                    }
                }
            }
        } catch (err) {
            logger.warn('Failed to load configuration:', err)
            setBranches([])
            if (!userEditedBranchRef.current) {
                baseBranchValueRef.current = ''
                setBaseBranch('')
            }
        } finally {
            setLoadingBranches(false)
        }
    }, [])

    useEffect(() => {
        loadConfiguration()
    }, [loadConfiguration])


    const handleBaseBranchChange = useCallback(async (branch: string) => {
        userEditedBranchRef.current = true
        baseBranchValueRef.current = branch
        prevInitialBaseBranchRef.current = branch
        setBaseBranch(branch)
        onBaseBranchChangeRef.current?.(branch)
        
        if (branch && branches.includes(branch)) {
            try {
                await invoke(TauriCommands.SetProjectDefaultBaseBranch, { branch })
            } catch (err) {
                logger.warn('Failed to save default branch:', err)
            }
        }
    }, [branches])

    const handleAgentTypeChange = useCallback(async (type: AgentType) => {
        agentTypeTouchedRef.current = true
        setAgentType(type)
        onAgentTypeChangeRef.current?.(type)
        await saveAgentType(type)
    }, [saveAgentType])

    const handleSkipPermissionsChange = useCallback(async (enabled: boolean) => {
        skipPermissionsTouchedRef.current = true
        setSkipPermissions(enabled)
        onSkipPermissionsChangeRef.current?.(enabled)
        await saveSkipPermissions(enabled)
    }, [saveSkipPermissions])

    // Ensure isValidBranch is considered "used" by TypeScript
    React.useEffect(() => {
        // This effect ensures the validation state is properly tracked
    }, [isValidBranch])

    useEffect(() => {
        if (initialBaseBranch === prevInitialBaseBranchRef.current) {
            return
        }

        prevInitialBaseBranchRef.current = initialBaseBranch

        if (typeof initialBaseBranch === 'string') {
            userEditedBranchRef.current = false
            baseBranchValueRef.current = initialBaseBranch
            setBaseBranch(initialBaseBranch)
        }
    }, [initialBaseBranch])

    useEffect(() => {
        if (initialSkipPermissions !== undefined && initialSkipPermissions !== skipPermissions) {
            initialSkipPermissionsRef.current = initialSkipPermissions
            skipPermissionsTouchedRef.current = false
            setSkipPermissions(initialSkipPermissions)
        }
    }, [initialSkipPermissions, skipPermissions])

    useEffect(() => {
        if (initialAgentType && initialAgentType !== agentType) {
            initialAgentTypeRef.current = initialAgentType
            agentTypeTouchedRef.current = false
            setAgentType(initialAgentType)
        }
    }, [initialAgentType, agentType])

    const isCompact = variant === 'compact'

    if (isCompact) {
        return (
            <div className="flex items-center gap-2 text-sm">
                <div className="flex items-center gap-1.5">
                    {!hideLabels && (
                        <span style={{ color: theme.colors.text.secondary }}>Branch:</span>
                    )}
                    {loadingBranches ? (
                        <div 
                            className="px-2 py-1 rounded text-xs"
                            style={{ 
                                backgroundColor: theme.colors.background.elevated
                            }}
                        >
                            <span className="text-slate-500 text-xs">Loading...</span>
                        </div>
                    ) : (
                        <div className="min-w-[120px]">
                            <BranchAutocomplete
                                value={baseBranch}
                                onChange={handleBaseBranchChange}
                                branches={branches}
                                disabled={disabled || branches.length === 0}
                                placeholder={branches.length === 0 ? "No branches" : "Select branch"}
                                onValidationChange={setIsValidBranch}
                                className="text-xs py-1 px-2"
                            />
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-1.5">
                    {!hideLabels && (
                        <span style={{ color: theme.colors.text.secondary }}>Agent:</span>
                    )}
                    <div className="min-w-[90px]">
                        <ModelSelector
                            value={agentType}
                            onChange={handleAgentTypeChange}
                            disabled={disabled}
                        />
                    </div>
                </div>

                {agentType !== 'opencode' && (
                    <div className="flex items-center gap-1.5">
                        <input 
                            id="session-skip-perms" 
                            type="checkbox" 
                            checked={skipPermissions} 
                            onChange={e => handleSkipPermissionsChange(e.target.checked)}
                            disabled={disabled}
                            className="text-blue-600"
                        />
                        <label 
                            htmlFor="session-skip-perms" 
                            className="text-xs"
                            style={{ color: theme.colors.text.secondary }}
                        >
                            Skip perms
                        </label>
                    </div>
                )}
            </div>
        )
    }

    return (
        <div className="grid grid-cols-3 gap-3">
            <div>
                <label className="block text-sm mb-1" style={{ color: theme.colors.text.secondary }}>
                    Base branch
                </label>
                {loadingBranches ? (
                    <div 
                        className="w-full rounded px-3 py-2 border flex items-center justify-center" 
                        style={{
                            backgroundColor: theme.colors.background.elevated,
                            borderColor: theme.colors.border.default
                        }}
                    >
                        <span className="text-slate-500 text-xs">Loading...</span>
                    </div>
                ) : (
                    <BranchAutocomplete
                        value={baseBranch}
                        onChange={handleBaseBranchChange}
                        branches={branches}
                        disabled={disabled || branches.length === 0}
                        placeholder={branches.length === 0 ? "No branches available" : "Type to search branches... (Tab to autocomplete)"}
                        onValidationChange={setIsValidBranch}
                    />
                )}
                <p className="text-xs mt-1" style={{ color: theme.colors.text.muted }}>
                    Branch from which to create the worktree
                </p>
            </div>

            <div>
                <label className="block text-sm mb-2" style={{ color: theme.colors.text.secondary }}>
                    Agent
                </label>
                <ModelSelector
                    value={agentType}
                    onChange={handleAgentTypeChange}
                    disabled={disabled}
                />
                <p className="text-xs mt-2" style={{ color: theme.colors.text.muted }}>
                    AI agent to use for this session
                </p>
            </div>

            {agentType !== 'opencode' && (
                <div className="flex items-center gap-2">
                    <input 
                        id="modal-skip-perms" 
                        type="checkbox" 
                        checked={skipPermissions} 
                        onChange={e => handleSkipPermissionsChange(e.target.checked)}
                        disabled={disabled}
                    />
                    <label 
                        htmlFor="modal-skip-perms" 
                        className="text-sm"
                        style={{ color: theme.colors.text.secondary }}
                    >
                        Skip permissions
                    </label>
                </div>
            )}
        </div>
    )
}

export function useSessionConfiguration(): [SessionConfiguration, (config: Partial<SessionConfiguration>) => void] {
    const [config, setConfig] = useState<SessionConfiguration>({
        baseBranch: '',
        agentType: 'claude',
        skipPermissions: false,
        isValid: false
    })

    const updateConfig = useCallback((updates: Partial<SessionConfiguration>) => {
        setConfig(prev => ({ ...prev, ...updates }))
    }, [])

    return [config, updateConfig]
}

export function useInitializedSessionConfiguration(): [SessionConfiguration, (config: Partial<SessionConfiguration>) => void] {
    const [config, setConfig] = useState<SessionConfiguration>({
        baseBranch: 'main', // Start with a reasonable default instead of empty
        agentType: 'claude',
        skipPermissions: false,
        isValid: true // Mark as valid since we have a branch
    })
    const { getSkipPermissions, getAgentType } = useClaudeSession()

    useEffect(() => {
        const initializeDefaults = async () => {
            try {
                const [defaultBranch, gitDefaultBranch, storedSkipPerms, storedAgentType] = await Promise.all([
                    invoke<string | null>(TauriCommands.GetProjectDefaultBaseBranch),
                    invoke<string>(TauriCommands.GetProjectDefaultBranch),
                    getSkipPermissions(),
                    getAgentType()
                ])
                
                const branch = defaultBranch || gitDefaultBranch || 'main'
                const normalizedAgentType =
                    typeof storedAgentType === 'string' && AGENT_TYPES.includes(storedAgentType as AgentType)
                        ? (storedAgentType as AgentType)
                        : 'claude'
                
                // Ensure we always have a valid branch
                const finalBranch = branch && branch.trim() !== '' ? branch.trim() : 'main'
                
                logger.info('[useInitializedSessionConfiguration] Initialized with:', {
                    baseBranch: finalBranch,
                    agentType: normalizedAgentType,
                    skipPermissions: storedSkipPerms,
                    defaultBranch,
                    gitDefaultBranch
                })
                
                setConfig({
                    baseBranch: finalBranch,
                    agentType: normalizedAgentType,
                    skipPermissions: storedSkipPerms,
                    isValid: true // Always valid since we ensure a branch
                })
            } catch (err) {
                logger.warn('Failed to initialize session configuration:', err)
                // Set minimal working defaults
                setConfig(prev => ({
                    ...prev,
                    baseBranch: 'main',
                    agentType: 'claude',
                    skipPermissions: false,
                    isValid: true
                }))
                logger.info('[useInitializedSessionConfiguration] Using fallback defaults: { baseBranch: "main", agentType: "claude", skipPermissions: false }')
            }
        }
        
        initializeDefaults()
    }, [getSkipPermissions, getAgentType])

    const updateConfig = useCallback((updates: Partial<SessionConfiguration>) => {
        setConfig(prev => ({ ...prev, ...updates }))
    }, [])

    return [config, updateConfig]
}
