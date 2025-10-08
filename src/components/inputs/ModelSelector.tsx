import { useState, useCallback, useMemo, useEffect } from 'react'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import { theme } from '../../common/theme'
import { Dropdown } from './Dropdown'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'

const MODEL_METADATA: Record<AgentType, { label: string; color: 'blue' | 'green' | 'orange' | 'red' | 'violet' }> = {
    claude: { label: 'Claude', color: 'blue' },
    opencode: { label: 'OpenCode', color: 'green' },
    gemini: { label: 'Gemini', color: 'orange' },
    codex: { label: 'Codex', color: 'red' },
    droid: { label: 'Droid', color: 'violet' }
}

interface ModelSelectorProps {
    value: AgentType
    onChange: (value: AgentType) => void
    disabled?: boolean
    skipPermissions?: boolean
    onSkipPermissionsChange?: (value: boolean) => void
    onDropdownOpenChange?: (open: boolean) => void
    showShortcutHint?: boolean
}

export function ModelSelector({
    value,
    onChange,
    disabled = false,
    skipPermissions,
    onSkipPermissionsChange,
    onDropdownOpenChange,
    showShortcutHint = false
}: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)
    const { isAvailable, getRecommendedPath, getInstallationMethod, loading } = useAgentAvailability()

    const models = useMemo(() => AGENT_TYPES.map(value => ({ value, ...MODEL_METADATA[value] })), [])

    const selectedModel = models.find(m => m.value === value) || models[0]
    const selectedSupportsPermissions = AGENT_SUPPORTS_SKIP_PERMISSIONS[selectedModel.value]
    const canConfigurePermissions = selectedSupportsPermissions && typeof skipPermissions === 'boolean' && typeof onSkipPermissionsChange === 'function'

    const handleSelect = useCallback((modelValue: AgentType) => {
        if (!isAvailable(modelValue)) return
        onChange(modelValue)
        setIsOpen(false)
    }, [onChange, isAvailable])

    const getTooltipText = useCallback((modelValue: AgentType) => {
        if (loading) return 'Checking availability...'
        if (!isAvailable(modelValue)) return `${modelValue} is not installed on this system. Please install it to use this agent.`
        const path = getRecommendedPath(modelValue)
        const method = getInstallationMethod(modelValue)
        if (path && method) return `${modelValue} is available at: ${path} (installed via ${method})`
        return `${modelValue} is available`
    }, [loading, isAvailable, getRecommendedPath, getInstallationMethod])

    const selectedAvailable = isAvailable(selectedModel.value)
    const selectedDisabled = disabled || (!selectedAvailable && !loading)

    useEffect(() => {
        if (!selectedSupportsPermissions && typeof skipPermissions === 'boolean' && skipPermissions && onSkipPermissionsChange) {
            onSkipPermissionsChange(false)
        }
    }, [selectedSupportsPermissions, skipPermissions, onSkipPermissionsChange])

    const handleRequirePermissions = useCallback(() => {
        if (!canConfigurePermissions || disabled || !onSkipPermissionsChange) return
        if (skipPermissions) {
            onSkipPermissionsChange(false)
        }
    }, [canConfigurePermissions, disabled, skipPermissions, onSkipPermissionsChange])

    const handleSkipPermissions = useCallback(() => {
        if (!canConfigurePermissions || disabled || !onSkipPermissionsChange) return
        if (!skipPermissions) {
            onSkipPermissionsChange(true)
        }
    }, [canConfigurePermissions, disabled, skipPermissions, onSkipPermissionsChange])

    const items = models.map(model => {
        const available = isAvailable(model.value)
        const canSelect = available || loading
        return {
            key: model.value,
            disabled: !canSelect,
            label: (
                <span className="flex items-center gap-2 text-sm">
                    {loading ? (
                        <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : (
                        <span className={`w-2 h-2 rounded-full ${!available && !loading ? 'opacity-50' : ''}`}
                              style={{
                                  backgroundColor: model.color === 'blue' ? theme.colors.accent.blue.DEFAULT :
                                                  model.color === 'green' ? theme.colors.accent.green.DEFAULT :
                                                  model.color === 'orange' ? theme.colors.accent.amber.DEFAULT :
                                                  model.color === 'violet' ? theme.colors.accent.violet.DEFAULT :
                                                  theme.colors.accent.red.DEFAULT
                              }} />
                    )}
                    <span className="flex items-center gap-1">
                        {model.label}
                        {!loading && !available && (
                            <svg className="w-3 h-3" style={{ color: theme.colors.status.warning }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        )}
                    </span>
                </span>
            ),
            title: getTooltipText(model.value)
        }
    })

    const dropdownOpen = isOpen && !disabled

    useEffect(() => {
        if (disabled && isOpen) {
            setIsOpen(false)
        }
    }, [disabled, isOpen])

    useEffect(() => {
        if (onDropdownOpenChange) {
            onDropdownOpenChange(dropdownOpen)
        }
    }, [dropdownOpen, onDropdownOpenChange])

    return (
        <div className="space-y-2">
            <Dropdown
                open={dropdownOpen}
                onOpenChange={setIsOpen}
                items={items}
                selectedKey={selectedModel.value}
                align="stretch"
                onSelect={(key) => handleSelect(key as typeof selectedModel.value)}
            >
                {({ open, toggle }) => (
                    <button
                        type="button"
                        onClick={() => !disabled && toggle()}
                        disabled={disabled}
                        className={`w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between ${
                            disabled
                                ? 'cursor-not-allowed'
                                : 'cursor-pointer'
                        } ${
                            selectedDisabled && !loading
                                ? 'opacity-50'
                                : selectedAvailable || loading
                                ? 'hover:opacity-80'
                                : ''
                        }`}
                        style={{
                            backgroundColor: theme.colors.background.elevated,
                            borderColor: theme.colors.border.default,
                            color: selectedDisabled && !loading ? theme.colors.text.muted : theme.colors.text.primary
                        }}
                        title={getTooltipText(selectedModel.value)}
                        aria-label={selectedModel.label}
                    >
                        <span className="flex items-center gap-2">
                            <span>{selectedModel.label}</span>
                            {showShortcutHint && (
                                <span
                                    aria-hidden="true"
                                    style={{ color: theme.colors.text.muted, fontSize: theme.fontSize.caption }}
                                >
                                    ⌘↑ · ⌘↓
                                </span>
                            )}
                        </span>
                        <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                            <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                        </svg>
                    </button>
                )}
            </Dropdown>
            {canConfigurePermissions && (
                <div className="flex gap-2" role="group" aria-label="Permission handling">
                    <button
                        type="button"
                        onClick={handleRequirePermissions}
                        disabled={disabled}
                        aria-pressed={!skipPermissions}
                        className="flex-1 px-3 py-1.5 rounded border text-xs"
                        style={{
                            backgroundColor: skipPermissions ? theme.colors.background.elevated : theme.colors.background.active,
                            borderColor: theme.colors.border.default,
                            color: disabled ? theme.colors.text.muted : (skipPermissions ? theme.colors.text.secondary : theme.colors.text.primary)
                        }}
                        title="Require macOS permission prompts when starting the agent"
                    >
                        Require permissions
                    </button>
                    <button
                        type="button"
                        onClick={handleSkipPermissions}
                        disabled={disabled}
                        aria-pressed={!!skipPermissions}
                        className="flex-1 px-3 py-1.5 rounded border text-xs"
                        style={{
                            backgroundColor: skipPermissions ? theme.colors.background.active : theme.colors.background.elevated,
                            borderColor: theme.colors.border.default,
                            color: disabled ? theme.colors.text.muted : (skipPermissions ? theme.colors.text.primary : theme.colors.text.secondary)
                        }}
                        title="Skip macOS permission prompts when starting the agent"
                    >
                        Skip permissions
                    </button>
                </div>
            )}
        </div>
    )
}
