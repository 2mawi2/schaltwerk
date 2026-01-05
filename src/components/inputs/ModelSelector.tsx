import { useState, useCallback, useMemo, useEffect } from 'react'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import { theme } from '../../common/theme'
import { Dropdown } from './Dropdown'
import { AgentType, AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS } from '../../types/session'
import { useTranslation } from '../../common/i18n'

type ModelColor = 'blue' | 'green' | 'orange' | 'red' | 'violet' | 'cyan' | 'yellow' | 'copilot'

const MODEL_METADATA: Record<AgentType, { label: string; color: ModelColor }> = {
    claude: { label: 'Claude', color: 'blue' },
    copilot: { label: 'GitHub Copilot', color: 'copilot' },
    opencode: { label: 'OpenCode', color: 'green' },
    gemini: { label: 'Gemini', color: 'orange' },
    codex: { label: 'Codex', color: 'red' },
    droid: { label: 'Droid', color: 'violet' },
    qwen: { label: 'Qwen', color: 'cyan' },
    amp: { label: 'Amp', color: 'yellow' },
    kilocode: { label: 'Kilo Code', color: 'yellow' },
    terminal: { label: 'Terminal Only', color: 'green' }
}

interface ModelSelectorProps {
    value: AgentType
    onChange: (value: AgentType) => void
    disabled?: boolean
    agentSelectionDisabled?: boolean
    skipPermissions?: boolean
    onSkipPermissionsChange?: (value: boolean) => void
    onDropdownOpenChange?: (open: boolean) => void
    showShortcutHint?: boolean
    allowedAgents?: readonly AgentType[]
}

export function ModelSelector({
    value,
    onChange,
    disabled = false,
    agentSelectionDisabled = false,
    skipPermissions,
    onSkipPermissionsChange,
    onDropdownOpenChange,
    showShortcutHint = false,
    allowedAgents
}: ModelSelectorProps) {
    const { t } = useTranslation()
    const [isOpen, setIsOpen] = useState(false)
    const { isAvailable, getRecommendedPath, getInstallationMethod, loading } = useAgentAvailability()

    const allowedList = useMemo(
        () => (allowedAgents && allowedAgents.length > 0 ? allowedAgents : AGENT_TYPES),
        [allowedAgents]
    )

    const models = useMemo(
        () => allowedList.map(value => ({ value, ...MODEL_METADATA[value] })),
        [allowedList]
    )

    const selectedModel = models.find(m => m.value === value) || models[0]
    const selectedSupportsPermissions = AGENT_SUPPORTS_SKIP_PERMISSIONS[selectedModel.value]
    const canConfigurePermissions = selectedSupportsPermissions && typeof skipPermissions === 'boolean' && typeof onSkipPermissionsChange === 'function'

    const handleSelect = useCallback((modelValue: AgentType) => {
        if (agentSelectionDisabled || !isAvailable(modelValue)) return
        onChange(modelValue)
        setIsOpen(false)
    }, [onChange, isAvailable, agentSelectionDisabled])

    const getTooltipText = useCallback((modelValue: AgentType) => {
        if (loading) return t.modelSelector.checkingAvailability
        if (!isAvailable(modelValue)) return t.modelSelector.notInstalled.replace('{agent}', modelValue)
        const path = getRecommendedPath(modelValue)
        const method = getInstallationMethod(modelValue)
        if (path && method) return t.modelSelector.availableAt.replace('{agent}', modelValue).replace('{path}', path).replace('{method}', method)
        return t.modelSelector.available.replace('{agent}', modelValue)
    }, [loading, isAvailable, getRecommendedPath, getInstallationMethod, t])

    const selectedAvailable = isAvailable(selectedModel.value)
    const dropdownDisabled = disabled || agentSelectionDisabled
    const selectedDisabled = dropdownDisabled || (!selectedAvailable && !loading)

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
                                  backgroundColor: model.color === 'blue' ? 'var(--color-accent-blue)' :
                                                  model.color === 'green' ? 'var(--color-accent-green)' :
                                                  model.color === 'orange' ? 'var(--color-accent-amber)' :
                                                  model.color === 'red' ? 'var(--color-accent-red)' :
                                                  model.color === 'violet' ? 'var(--color-accent-violet)' :
                                                  model.color === 'cyan' ? 'var(--color-accent-cyan)' :
                                                  model.color === 'yellow' ? 'var(--color-accent-yellow)' :
                                                  model.color === 'copilot' ? 'var(--color-accent-copilot)' :
                                                  'var(--color-accent-red)'
                              }} />
                    )}
                    <span className="flex items-center gap-1">
                        {model.label}
                        {!loading && !available && (
                            <svg className="w-3 h-3" style={{ color: 'var(--color-status-warning)' }} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        )}
                    </span>
                </span>
            ),
            title: getTooltipText(model.value)
        }
    })

    const dropdownOpen = isOpen && !dropdownDisabled

    useEffect(() => {
        if (dropdownDisabled && isOpen) {
            setIsOpen(false)
        }
    }, [dropdownDisabled, isOpen])

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
                onSelect={(key) => {
                    if (agentSelectionDisabled) return
                    handleSelect(key as typeof selectedModel.value)
                }}
            >
                {({ open, toggle }) => (
                    <button
                        type="button"
                        onClick={() => !dropdownDisabled && toggle()}
                        disabled={dropdownDisabled}
                        className={`w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between ${
                            dropdownDisabled
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
                            backgroundColor: 'var(--color-bg-elevated)',
                            borderColor: 'var(--color-border-default)',
                            color: selectedDisabled && !loading ? 'var(--color-text-muted)' : 'var(--color-text-primary)'
                        }}
                        title={getTooltipText(selectedModel.value)}
                        aria-label={selectedModel.label}
                    >
                        <span className="flex items-center gap-2">
                            <span>{selectedModel.label}</span>
                            {showShortcutHint && (
                                <span
                                    aria-hidden="true"
                                    style={{ color: 'var(--color-text-muted)', fontSize: theme.fontSize.caption }}
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
                <div className="flex gap-2" role="group" aria-label={t.modelSelector.permissionHandling}>
                    <button
                        type="button"
                        onClick={handleRequirePermissions}
                        disabled={disabled}
                        aria-pressed={!skipPermissions}
                        className="flex-1 px-3 py-1.5 rounded border text-xs"
                        style={{
                            backgroundColor: skipPermissions ? 'var(--color-bg-elevated)' : 'var(--color-bg-active)',
                            borderColor: 'var(--color-border-default)',
                            color: disabled ? 'var(--color-text-muted)' : (skipPermissions ? 'var(--color-text-secondary)' : 'var(--color-text-primary)')
                        }}
                        title={t.sessionConfig.requirePermissionsTitle}
                    >
                        {t.sessionConfig.requirePermissions}
                    </button>
                    <button
                        type="button"
                        onClick={handleSkipPermissions}
                        disabled={disabled}
                        aria-pressed={!!skipPermissions}
                        className="flex-1 px-3 py-1.5 rounded border text-xs"
                        style={{
                            backgroundColor: skipPermissions ? 'var(--color-bg-active)' : 'var(--color-bg-elevated)',
                            borderColor: 'var(--color-border-default)',
                            color: disabled ? 'var(--color-text-muted)' : (skipPermissions ? 'var(--color-text-primary)' : 'var(--color-text-secondary)')
                        }}
                        title={t.sessionConfig.skipPermissionsTitle}
                    >
                        {t.sessionConfig.skipPermissions}
                    </button>
                </div>
            )}
        </div>
    )
}
