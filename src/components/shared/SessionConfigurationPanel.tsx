import { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import React from 'react'
import { BranchAutocomplete } from '../inputs/BranchAutocomplete'
import { ModelSelector } from '../inputs/ModelSelector'
import { Dropdown } from '../inputs/Dropdown'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { logger } from '../../utils/logger'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'
import { FALLBACK_CODEX_MODELS, CodexModelMetadata } from '../../common/codexModels'

interface SessionConfigurationPanelProps {
    variant?: 'modal' | 'compact'
    onBaseBranchChange?: (branch: string) => void
    onAgentTypeChange?: (agentType: AgentType) => void
    onSkipPermissionsChange?: (enabled: boolean) => void
    onCustomBranchChange?: (branch: string) => void
    onUseExistingBranchChange?: (useExisting: boolean) => void
    initialBaseBranch?: string
    initialAgentType?: AgentType
    initialSkipPermissions?: boolean
    initialCustomBranch?: string
    initialUseExistingBranch?: boolean
    codexModel?: string
    codexModelOptions?: string[]
    codexModels?: CodexModelMetadata[]
    onCodexModelChange?: (model: string) => void
    codexReasoningEffort?: string
    onCodexReasoningChange?: (effort: string) => void
    sessionName?: string
    disabled?: boolean
    hideLabels?: boolean
    hideAgentType?: boolean
    ignorePersistedAgentType?: boolean
    agentControlsDisabled?: boolean
    branchError?: string
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
    onCustomBranchChange,
    onUseExistingBranchChange,
    initialBaseBranch = '',
    initialAgentType = 'claude',
    initialSkipPermissions = false,
    initialCustomBranch = '',
    initialUseExistingBranch = false,
    codexModel,
    codexModelOptions,
    codexModels,
    onCodexModelChange,
    codexReasoningEffort,
    onCodexReasoningChange,
    sessionName = '',
    disabled = false,
    hideLabels = false,
    hideAgentType = false,
    ignorePersistedAgentType = false,
    agentControlsDisabled = false,
    branchError
}: SessionConfigurationPanelProps) {
    const [baseBranch, setBaseBranch] = useState(initialBaseBranch)
    const [branches, setBranches] = useState<string[]>([])
    const [loadingBranches, setLoadingBranches] = useState(false)
    const [isValidBranch, setIsValidBranch] = useState(true)
    const [agentType, setAgentType] = useState<AgentType>(initialAgentType)
    const [skipPermissions, setSkipPermissions] = useState(initialSkipPermissions)
    const [customBranch, setCustomBranch] = useState(initialCustomBranch)
    const [useExistingBranch, setUseExistingBranch] = useState(initialUseExistingBranch)
    const [branchPrefix, setBranchPrefix] = useState<string>('schaltwerk')
    const { getSkipPermissions, setSkipPermissions: saveSkipPermissions, getAgentType, setAgentType: saveAgentType } = useClaudeSession()

    const onBaseBranchChangeRef = useRef(onBaseBranchChange)
    const onAgentTypeChangeRef = useRef(onAgentTypeChange)
    const onSkipPermissionsChangeRef = useRef(onSkipPermissionsChange)
    const onCustomBranchChangeRef = useRef(onCustomBranchChange)
    const onUseExistingBranchChangeRef = useRef(onUseExistingBranchChange)
    const baseBranchValueRef = useRef(initialBaseBranch)
    const userEditedBranchRef = useRef(false)
    const skipPermissionsTouchedRef = useRef(false)
    const agentTypeTouchedRef = useRef(false)
    const initialSkipPermissionsRef = useRef(initialSkipPermissions)
    const initialAgentTypeRef = useRef(initialAgentType)
    const getSkipPermissionsRef = useRef(getSkipPermissions)
    const getAgentTypeRef = useRef(getAgentType)
    const saveAgentTypeRef = useRef(saveAgentType)
    const saveSkipPermissionsRef = useRef(saveSkipPermissions)
    const prevInitialBaseBranchRef = useRef(initialBaseBranch)
    const agentSelectionDisabled = agentControlsDisabled

    useEffect(() => { onBaseBranchChangeRef.current = onBaseBranchChange }, [onBaseBranchChange])
    useEffect(() => { onAgentTypeChangeRef.current = onAgentTypeChange }, [onAgentTypeChange])
    useEffect(() => { onSkipPermissionsChangeRef.current = onSkipPermissionsChange }, [onSkipPermissionsChange])
    useEffect(() => { onCustomBranchChangeRef.current = onCustomBranchChange }, [onCustomBranchChange])
    useEffect(() => { onUseExistingBranchChangeRef.current = onUseExistingBranchChange }, [onUseExistingBranchChange])
    useEffect(() => { getSkipPermissionsRef.current = getSkipPermissions }, [getSkipPermissions])
    useEffect(() => { getAgentTypeRef.current = getAgentType }, [getAgentType])
    useEffect(() => { saveAgentTypeRef.current = saveAgentType }, [saveAgentType])
    useEffect(() => { saveSkipPermissionsRef.current = saveSkipPermissions }, [saveSkipPermissions])

    useEffect(() => {
        baseBranchValueRef.current = baseBranch
    }, [baseBranch])

    const loadConfiguration = useCallback(async () => {
        setLoadingBranches(true)
        try {
            const [branchList, savedDefaultBranch, gitDefaultBranch, storedSkipPerms, storedAgentType, projectSettings] = await Promise.all([
                invoke<string[]>(TauriCommands.ListProjectBranches),
                invoke<string | null>(TauriCommands.GetProjectDefaultBaseBranch),
                invoke<string>(TauriCommands.GetProjectDefaultBranch),
                getSkipPermissionsRef.current(),
                getAgentTypeRef.current(),
                invoke<{ branch_prefix: string }>(TauriCommands.GetProjectSettings).catch(() => ({ branch_prefix: '' }))
            ])

            const storedBranchPrefix = projectSettings.branch_prefix ?? ''

            setBranches(branchList)
            setBranchPrefix(storedBranchPrefix)

            const hasUserBranch = userEditedBranchRef.current || !!(baseBranchValueRef.current && baseBranchValueRef.current.trim() !== '')
            if (!hasUserBranch) {
                const defaultBranch = savedDefaultBranch || gitDefaultBranch
                if (defaultBranch) {
                    baseBranchValueRef.current = defaultBranch
                    setBaseBranch(defaultBranch)
                    onBaseBranchChangeRef.current?.(defaultBranch)
                }
            }

            const storedAgentTypeString = typeof storedAgentType === 'string' ? storedAgentType : null
            const normalizedType =
                storedAgentTypeString && AGENT_TYPES.includes(storedAgentTypeString as AgentType)
                    ? (storedAgentTypeString as AgentType)
                    : 'claude'

            const supportsSkip = AGENT_SUPPORTS_SKIP_PERMISSIONS[normalizedType]
            const normalizedSkip = supportsSkip ? storedSkipPerms : false

            if (!skipPermissionsTouchedRef.current && !initialSkipPermissionsRef.current) {
                setSkipPermissions(normalizedSkip)
                onSkipPermissionsChangeRef.current?.(normalizedSkip)

                if (!supportsSkip && storedSkipPerms) {
                    try {
                        await saveSkipPermissionsRef.current?.(false)
                    } catch (err) {
                        logger.warn('Failed to reset skip permissions for unsupported agent:', err)
                    }
                }
            }

            if (!ignorePersistedAgentType && !agentTypeTouchedRef.current && initialAgentTypeRef.current === 'claude') {
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
    }, [ignorePersistedAgentType])

    useEffect(() => {
        void loadConfiguration()
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

    const handleSkipPermissionsChange = useCallback(async (enabled: boolean) => {
        skipPermissionsTouchedRef.current = true
        setSkipPermissions(enabled)
        onSkipPermissionsChangeRef.current?.(enabled)
        await saveSkipPermissions(enabled)
    }, [saveSkipPermissions])

    const handleAgentTypeChange = useCallback(async (type: AgentType) => {
        agentTypeTouchedRef.current = true
        setAgentType(type)
        onAgentTypeChangeRef.current?.(type)
        await saveAgentType(type)

        if (!AGENT_SUPPORTS_SKIP_PERMISSIONS[type] && skipPermissions) {
            await handleSkipPermissionsChange(false)
        }
    }, [saveAgentType, skipPermissions, handleSkipPermissionsChange])

    const handleCustomBranchChange = useCallback((branch: string) => {
        setCustomBranch(branch)
        onCustomBranchChangeRef.current?.(branch)
    }, [])

    const handleUseExistingBranchChange = useCallback((useExisting: boolean) => {
        setUseExistingBranch(useExisting)
        onUseExistingBranchChangeRef.current?.(useExisting)
        if (useExisting) {
            setCustomBranch('')
            onCustomBranchChangeRef.current?.('')
        }
    }, [])

    const effectiveCodexModels = useMemo(() => {
        if (codexModels && codexModels.length > 0) {
            return codexModels
        }
        return FALLBACK_CODEX_MODELS
    }, [codexModels])

    const effectiveCodexModelOptions = useMemo(() => {
        if (codexModelOptions && codexModelOptions.length > 0) {
            return codexModelOptions
        }
        return effectiveCodexModels.map(model => model.id)
    }, [codexModelOptions, effectiveCodexModels])

    const selectedCodexMetadata = useMemo(() => {
        if (!codexModel) return undefined
        return effectiveCodexModels.find(model => model.id === codexModel)
    }, [codexModel, effectiveCodexModels])

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
            const supports = AGENT_SUPPORTS_SKIP_PERMISSIONS[agentType]
            setSkipPermissions(supports ? initialSkipPermissions : false)
        }
    }, [initialSkipPermissions, skipPermissions, agentType])

    useEffect(() => {
        if (initialAgentType && initialAgentType !== agentType) {
            initialAgentTypeRef.current = initialAgentType
            agentTypeTouchedRef.current = false
            setAgentType(initialAgentType)
        }
    }, [initialAgentType, agentType])

    useEffect(() => {
        if (initialUseExistingBranch !== useExistingBranch) {
            setUseExistingBranch(initialUseExistingBranch)
        }
    }, [initialUseExistingBranch, useExistingBranch])

    const isCompact = variant === 'compact'
    const shouldShowShortcutHint = variant === 'modal' && !hideAgentType

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
                                onChange={(branch) => { void handleBaseBranchChange(branch) }}
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
                            onChange={(type) => { void handleAgentTypeChange(type) }}
                            disabled={disabled}
                            agentSelectionDisabled={agentSelectionDisabled}
                            skipPermissions={skipPermissions}
                            onSkipPermissionsChange={(enabled) => { void handleSkipPermissionsChange(enabled) }}
                            showShortcutHint={shouldShowShortcutHint}
                        />
                    </div>
                </div>
            </div>
        )
    }

    const normalizedSessionName = sessionName.replace(/ /g, '_')
    const branchPlaceholder = branchPrefix
        ? (normalizedSessionName ? `${branchPrefix}/${normalizedSessionName}` : `${branchPrefix}/your-session-name`)
        : (normalizedSessionName || 'your-session-name')

    return (
        <div className="grid grid-cols-2 gap-3">
            <div className="flex flex-col gap-3">
                <div data-onboarding="base-branch-selector">
                    <div className="flex items-center justify-between mb-1">
                        <label className="block text-sm" style={{ color: theme.colors.text.secondary }}>
                            {useExistingBranch ? 'Existing branch' : 'Base branch'}
                        </label>
                        <label className={`flex items-center gap-1.5 text-xs cursor-pointer ${branchError ? 'text-red-400' : ''}`} style={branchError ? undefined : { color: theme.colors.text.secondary }}>
                            <input
                                type="checkbox"
                                checked={useExistingBranch}
                                onChange={(e) => handleUseExistingBranchChange(e.target.checked)}
                                disabled={disabled}
                                className={`rounded ${branchError ? 'accent-red-500' : ''}`}
                            />
                            <span>Use existing branch</span>
                        </label>
                    </div>
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
                            onChange={(branch) => { void handleBaseBranchChange(branch) }}
                            branches={branches}
                            disabled={disabled || branches.length === 0}
                            placeholder={branches.length === 0 ? "No branches available" : "Type to search branches... (Tab to autocomplete)"}
                            onValidationChange={setIsValidBranch}
                            hasError={!!branchError}
                        />
                    )}
                    {branchError ? (
                        <div className="flex items-start gap-2 mt-1">
                            <svg className="w-4 h-4 text-red-400 mt-0.5 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                            </svg>
                            <p className="text-xs text-red-400">{branchError}</p>
                        </div>
                    ) : (
                        <p className="text-xs mt-1" style={{ color: theme.colors.text.muted }}>
                            {useExistingBranch
                                ? 'Branch to check out directly (must not be in use by another worktree)'
                                : 'Existing branch to create the new worktree from'}
                        </p>
                    )}
                </div>

                {!useExistingBranch && (
                    <div>
                        <label className="block text-sm mb-1" style={{ color: theme.colors.text.secondary }}>
                            Branch name (optional)
                        </label>
                        <input
                            value={customBranch}
                            onChange={(e) => handleCustomBranchChange(e.target.value)}
                            className="w-full rounded px-3 py-2 border"
                            style={{
                                backgroundColor: theme.colors.background.elevated,
                                color: theme.colors.text.primary,
                                borderColor: theme.colors.border.default
                            }}
                            placeholder={branchPlaceholder}
                            disabled={disabled}
                        />
                        <p className="text-xs mt-1" style={{ color: theme.colors.text.muted }}>
                            New branch name for this session. Leave empty to auto-generate: {branchPlaceholder}
                        </p>
                    </div>
                )}
            </div>

            {!hideAgentType && (
                <div>
                    <label className="block text-sm mb-2" style={{ color: theme.colors.text.secondary }}>
                        Agent
                    </label>
                    <div className="space-y-3">
                        <ModelSelector
                            value={agentType}
                            onChange={(type) => { void handleAgentTypeChange(type) }}
                            disabled={disabled}
                            agentSelectionDisabled={agentSelectionDisabled}
                            skipPermissions={skipPermissions}
                            onSkipPermissionsChange={(enabled) => { void handleSkipPermissionsChange(enabled) }}
                            showShortcutHint={shouldShowShortcutHint}
                        />
                        {agentType === 'codex' && effectiveCodexModelOptions && onCodexModelChange && (
                            <CodexModelSelector
                                disabled={disabled || agentSelectionDisabled}
                                options={effectiveCodexModelOptions}
                                codexModels={effectiveCodexModels}
                                value={codexModel}
                                onChange={onCodexModelChange}
                                showShortcutHint={shouldShowShortcutHint}
                                reasoningValue={codexReasoningEffort}
                                onReasoningChange={onCodexReasoningChange}
                                selectedModelMetadata={selectedCodexMetadata}
                            />
                        )}
                    </div>
                    <p className="text-xs mt-2" style={{ color: theme.colors.text.muted }}>
                        AI agent to use for this session
                    </p>
                </div>
            )}
        </div>
    )
}

interface CodexModelSelectorProps {
    options: string[]
    codexModels: CodexModelMetadata[]
    value?: string
    onChange: (value: string) => void
    disabled?: boolean
    showShortcutHint?: boolean
    reasoningValue?: string
    onReasoningChange?: (value: string) => void
    selectedModelMetadata?: CodexModelMetadata
}

function CodexModelSelector({
    options,
    codexModels,
    value,
    onChange,
    disabled,
    showShortcutHint = false,
    reasoningValue,
    onReasoningChange,
    selectedModelMetadata
}: CodexModelSelectorProps) {
    const [open, setOpen] = useState(false)
    const [reasoningOpen, setReasoningOpen] = useState(false)
    const normalizedOptions = useMemo(
        () => options.filter(option => option && option.trim().length > 0),
        [options]
    )

    const codexMetadataById = useMemo(() => {
        const map = new Map<string, CodexModelMetadata>()
        codexModels.forEach(model => {
            map.set(model.id, model)
        })
        return map
    }, [codexModels])

    const selectedKey = useMemo(() => {
        if (!value) return undefined
        return normalizedOptions.includes(value) ? value : undefined
    }, [normalizedOptions, value])

    const hasOptions = normalizedOptions.length > 0
    const placeholder = hasOptions ? 'Select Codex model' : 'No models available'
    const buttonDisabled = disabled || !hasOptions
    const modelItems = useMemo(
        () =>
            normalizedOptions.map(option => {
                const meta = codexMetadataById.get(option)
                return {
                    key: option,
                    label: (
                        <span className="flex flex-col text-left">
                            <span>{meta?.label ?? option}</span>
                            {meta?.description && (
                                <span className="text-xs" style={{ color: theme.colors.text.muted }}>
                                    {meta.description}
                                </span>
                            )}
                        </span>
                    ),
                    title: meta?.description,
                }
            }),
        [normalizedOptions, codexMetadataById]
    )

    const reasoningMetadata = useMemo(
        () => selectedModelMetadata?.reasoningOptions ?? [],
        [selectedModelMetadata]
    )

    const reasoningItems = useMemo(
        () =>
            reasoningMetadata.map(option => ({
                key: option.id,
                label: (
                    <span className="flex flex-col text-left">
                        <span>{option.label}</span>
                        <span className="text-xs" style={{ color: theme.colors.text.muted }}>
                            {option.description}
                        </span>
                    </span>
                ),
                title: option.description
            })),
        [reasoningMetadata]
    )

    const selectedReasoningKey = useMemo(() => {
        if (!reasoningValue) return undefined
        return reasoningMetadata.some(option => option.id === reasoningValue) ? reasoningValue : undefined
    }, [reasoningMetadata, reasoningValue])

    const reasoningButtonDisabled =
        disabled || reasoningMetadata.length === 0 || !onReasoningChange
    const reasoningPlaceholder = reasoningMetadata.length > 0 ? 'Select reasoning effort' : 'No reasoning options available'
    const selectedModelLabel = selectedKey
        ? codexMetadataById.get(selectedKey)?.label ?? selectedKey
        : placeholder
    const showReasoningSelector = reasoningMetadata.length > 0 && !!onReasoningChange

    useEffect(() => {
        if (reasoningButtonDisabled && reasoningOpen) {
            setReasoningOpen(false)
        }
    }, [reasoningButtonDisabled, reasoningOpen])

    return (
        <div className="space-y-3">
            <div className="space-y-1">
                <span className="block text-sm" style={{ color: theme.colors.text.secondary }}>
                    Model
                </span>
                <Dropdown
                open={!buttonDisabled && open}
                onOpenChange={(next) => setOpen(!buttonDisabled && next)}
                items={modelItems}
                selectedKey={selectedKey}
                align="stretch"
                onSelect={key => onChange(key)}
            >
                {({ toggle, open: dropdownOpen }) => (
                    <button
                        type="button"
                        data-testid="codex-model-selector"
                        onClick={() => !buttonDisabled && toggle()}
                        className={`w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between ${
                            buttonDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:opacity-80'
                        }`}
                        style={{
                            backgroundColor: theme.colors.background.elevated,
                            borderColor: dropdownOpen ? theme.colors.border.default : theme.colors.border.subtle,
                            color: theme.colors.text.primary
                        }}
                        disabled={buttonDisabled}
                    >
                        <span>{selectedModelLabel}</span>
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}
                </Dropdown>
            </div>
            {showReasoningSelector && (
                <div className="space-y-1">
                    <span className="block text-sm" style={{ color: theme.colors.text.secondary }}>
                        Reasoning effort
                    </span>
                    <Dropdown
                        open={!reasoningButtonDisabled && reasoningOpen}
                        onOpenChange={(next) => setReasoningOpen(!reasoningButtonDisabled && next)}
                        items={reasoningItems}
                        selectedKey={selectedReasoningKey}
                        align="stretch"
                        onSelect={key => onReasoningChange?.(key)}
                    >
                        {({ toggle, open: dropdownOpen }) => (
                            <button
                                type="button"
                                data-testid="codex-reasoning-selector"
                                onClick={() => !reasoningButtonDisabled && toggle()}
                                className={`w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between ${
                                    reasoningButtonDisabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer hover:opacity-80'
                                }`}
                                style={{
                                    backgroundColor: theme.colors.background.elevated,
                                    borderColor: dropdownOpen ? theme.colors.border.default : theme.colors.border.subtle,
                                    color: theme.colors.text.primary
                                }}
                                disabled={reasoningButtonDisabled}
                            >
                                <span className="flex items-center gap-2">
                                    {selectedReasoningKey
                                        ? reasoningMetadata.find(option => option.id === selectedReasoningKey)?.label ??
                                          selectedReasoningKey
                                        : reasoningPlaceholder}
                                    {showShortcutHint && (
                                        <span
                                            aria-hidden="true"
                                            style={{ color: theme.colors.text.muted, fontSize: theme.fontSize.caption }}
                                        >
                                            ⌘← · ⌘→
                                        </span>
                                    )}
                                </span>
                                <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor">
                                    <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                                </svg>
                            </button>
                        )}
                    </Dropdown>
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
