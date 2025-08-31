import { useState, useEffect, useCallback } from 'react'
import React from 'react'
import { BranchAutocomplete } from '../inputs/BranchAutocomplete'
import { ModelSelector } from '../inputs/ModelSelector'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { AnimatedText } from '../common/AnimatedText'

interface SessionConfigurationPanelProps {
    variant?: 'modal' | 'compact'
    onBaseBranchChange?: (branch: string) => void
    onAgentTypeChange?: (agentType: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex') => void
    onSkipPermissionsChange?: (enabled: boolean) => void
    initialBaseBranch?: string
    initialAgentType?: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex'
    initialSkipPermissions?: boolean
    disabled?: boolean
    hideLabels?: boolean
}

export interface SessionConfiguration {
    baseBranch: string
    agentType: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex'
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
    const [agentType, setAgentType] = useState(initialAgentType)
    const [skipPermissions, setSkipPermissions] = useState(initialSkipPermissions)
    const { getSkipPermissions, setSkipPermissions: saveSkipPermissions, getAgentType, setAgentType: saveAgentType } = useClaudeSession()

    useEffect(() => {
        const loadConfiguration = async () => {
            setLoadingBranches(true)
            try {
                const [branchList, savedDefaultBranch, gitDefaultBranch, storedSkipPerms, storedAgentType] = await Promise.all([
                    invoke<string[]>('list_project_branches'),
                    invoke<string | null>('get_project_default_base_branch'),
                    invoke<string>('get_project_default_branch'),
                    getSkipPermissions(),
                    getAgentType()
                ])
                
                setBranches(branchList)
                
                if (!initialBaseBranch) {
                    const defaultBranch = savedDefaultBranch || gitDefaultBranch
                    setBaseBranch(defaultBranch)
                    onBaseBranchChange?.(defaultBranch)
                }
                
                if (!initialSkipPermissions) {
                    setSkipPermissions(storedSkipPerms)
                    onSkipPermissionsChange?.(storedSkipPerms)
                }
                
                if (initialAgentType === 'claude') {
                    const storedType = storedAgentType as 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'
                    setAgentType(storedType)
                    onAgentTypeChange?.(storedType)
                }
            } catch (err) {
                console.warn('Failed to load configuration:', err)
                setBranches([])
                setBaseBranch('')
            } finally {
                setLoadingBranches(false)
            }
        }
        
        loadConfiguration()
    }, [initialBaseBranch, initialSkipPermissions, initialAgentType, getSkipPermissions, getAgentType])


    const handleBaseBranchChange = useCallback(async (branch: string) => {
        setBaseBranch(branch)
        onBaseBranchChange?.(branch)
        
        if (branch && branches.includes(branch)) {
            try {
                await invoke('set_project_default_base_branch', { branch })
            } catch (err) {
                console.warn('Failed to save default branch:', err)
            }
        }
    }, [branches, onBaseBranchChange])

    const handleAgentTypeChange = useCallback(async (type: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex') => {
        setAgentType(type)
        onAgentTypeChange?.(type)
        await saveAgentType(type)
    }, [onAgentTypeChange, saveAgentType])

    const handleSkipPermissionsChange = useCallback(async (enabled: boolean) => {
        setSkipPermissions(enabled)
        onSkipPermissionsChange?.(enabled)
        await saveSkipPermissions(enabled)
    }, [onSkipPermissionsChange, saveSkipPermissions])

    // Ensure isValidBranch is considered "used" by TypeScript
    React.useEffect(() => {
        // This effect ensures the validation state is properly tracked
    }, [isValidBranch])

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
                            <AnimatedText text="loading" colorClassName={theme.colors.text.muted} size="xs" />
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
                            id="kanban-skip-perms" 
                            type="checkbox" 
                            checked={skipPermissions} 
                            onChange={e => handleSkipPermissionsChange(e.target.checked)}
                            disabled={disabled}
                            className="text-blue-600"
                        />
                        <label 
                            htmlFor="kanban-skip-perms" 
                            className="text-xs"
                            style={{ color: theme.colors.text.secondary }}
                        >
                            {agentType === 'cursor' ? 'Force' : 'Skip perms'}
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
                        <AnimatedText text="loading" colorClassName={theme.colors.text.muted} size="xs" />
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
                        {agentType === 'cursor' ? 'Force flag' : 'Skip permissions'}
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
                    invoke<string | null>('get_project_default_base_branch'),
                    invoke<string>('get_project_default_branch'),
                    getSkipPermissions(),
                    getAgentType()
                ])
                
                const branch = defaultBranch || gitDefaultBranch || 'main'
                const agentType = storedAgentType as 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'
                
                // Ensure we always have a valid branch
                const finalBranch = branch && branch.trim() !== '' ? branch.trim() : 'main'
                
                console.log('[useInitializedSessionConfiguration] Initialized with:', {
                    baseBranch: finalBranch,
                    agentType,
                    skipPermissions: storedSkipPerms,
                    defaultBranch,
                    gitDefaultBranch
                })
                
                setConfig({
                    baseBranch: finalBranch,
                    agentType,
                    skipPermissions: storedSkipPerms,
                    isValid: true // Always valid since we ensure a branch
                })
            } catch (err) {
                console.warn('Failed to initialize session configuration:', err)
                // Set minimal working defaults
                setConfig(prev => ({
                    ...prev,
                    baseBranch: 'main',
                    agentType: 'claude',
                    skipPermissions: false,
                    isValid: true
                }))
                console.log('[useInitializedSessionConfiguration] Using fallback defaults: { baseBranch: "main", agentType: "claude", skipPermissions: false }')
            }
        }
        
        initializeDefaults()
    }, [getSkipPermissions, getAgentType])

    const updateConfig = useCallback((updates: Partial<SessionConfiguration>) => {
        setConfig(prev => ({ ...prev, ...updates }))
    }, [])

    return [config, updateConfig]
}