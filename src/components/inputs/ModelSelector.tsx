import { useState, useCallback, useMemo } from 'react'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import { theme } from '../../common/theme'
import { Dropdown } from './Dropdown'
import { AgentType, AGENT_TYPES } from '../../types/session'

const MODEL_METADATA: Record<AgentType, { label: string; color: string }> = {
    claude: { label: 'Claude', color: 'blue' },
    cursor: { label: 'Cursor', color: 'purple' },
    opencode: { label: 'OpenCode', color: 'green' },
    gemini: { label: 'Gemini', color: 'orange' },
    qwen: { label: 'Qwen Code', color: 'cyan' },
    codex: { label: 'Codex', color: 'red' }
}

interface ModelSelectorProps {
    value: AgentType
    onChange: (value: AgentType) => void
    disabled?: boolean
}

export function ModelSelector({ value, onChange, disabled = false }: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)
    const { isAvailable, getRecommendedPath, getInstallationMethod, loading } = useAgentAvailability()

    const models = useMemo(() => AGENT_TYPES.map(value => ({ value, ...MODEL_METADATA[value] })), [])

    const selectedModel = models.find(m => m.value === value) || models[0]

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
                        <span className={`w-2 h-2 rounded-full ${
                            model.color === 'blue' ? 'bg-blue-500' : 
                            model.color === 'purple' ? 'bg-purple-500' : 
                            model.color === 'green' ? 'bg-green-500' : 
                            model.color === 'orange' ? 'bg-orange-500' :
                            model.color === 'cyan' ? 'bg-cyan-500' : 'bg-red-500'
                        } ${!available && !loading ? 'opacity-50' : ''}`} />
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

    return (
        <Dropdown
            open={isOpen && !disabled}
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
                    <span>{selectedModel.label}</span>
                    <svg className="w-3 h-3" viewBox="0 0 20 20" fill="currentColor" style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 120ms ease' }}>
                        <path fillRule="evenodd" d="M5.23 7.21a.75.75 0 011.06.02L10 10.94l3.71-3.71a.75.75 0 111.06 1.06l-4.24 4.24a.75.75 0 01-1.06 0L5.21 8.29a.75.75 0 01.02-1.08z" clipRule="evenodd" />
                    </svg>
                </button>
            )}
        </Dropdown>
    )
}
