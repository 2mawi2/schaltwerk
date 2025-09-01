import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useAgentAvailability } from '../../hooks/useAgentAvailability'
import { theme } from '../../common/theme'

interface ModelSelectorProps {
    value: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex'
    onChange: (value: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex') => void
    disabled?: boolean
}

export function ModelSelector({ value, onChange, disabled = false }: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [focusedIndex, setFocusedIndex] = useState(-1)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const { isAvailable, getRecommendedPath, getInstallationMethod, loading } = useAgentAvailability()
    
    const models: Array<{ value: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex', label: string, color: string }> = useMemo(() => [
        { value: 'claude', label: 'Claude', color: 'blue' },
        { value: 'cursor', label: 'Cursor', color: 'purple' },
        { value: 'opencode', label: 'OpenCode', color: 'green' },
        { value: 'gemini', label: 'Gemini', color: 'orange' },
        { value: 'qwen', label: 'Qwen Code', color: 'cyan' },
        { value: 'codex', label: 'Codex', color: 'red' }
    ], [])

    const selectedModel = models.find(m => m.value === value) || models[0]

    const handleSelect = useCallback((modelValue: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'qwen' | 'codex') => {
        // Only block selection if we know it's unavailable
        if (!isAvailable(modelValue)) {
            return
        }
        onChange(modelValue)
        setIsOpen(false)
        setFocusedIndex(-1)
    }, [onChange, setIsOpen, setFocusedIndex, isAvailable])

    const getTooltipText = useCallback((modelValue: string) => {
        if (loading) {
            return 'Checking availability...'
        }
        
        if (!isAvailable(modelValue)) {
            return `${modelValue} is not installed on this system. Please install it to use this agent.`
        }
        
        const path = getRecommendedPath(modelValue)
        const method = getInstallationMethod(modelValue)
        
        if (path && method) {
            return `${modelValue} is available at: ${path} (installed via ${method})`
        }
        
        return `${modelValue} is available`
    }, [loading, isAvailable, getRecommendedPath, getInstallationMethod])

    useEffect(() => {
        if (isOpen) {
            const currentIndex = models.findIndex(m => m.value === value)
            setFocusedIndex(currentIndex >= 0 ? currentIndex : 0)
        }
    }, [isOpen, value, models])

    useEffect(() => {
        if (!isOpen) return

        const handleKeyDown = (e: KeyboardEvent) => {
            switch (e.key) {
                case 'ArrowDown':
                    e.preventDefault()
                    setFocusedIndex(prev => {
                        const next = prev + 1
                        return next >= models.length ? 0 : next
                    })
                    break
                case 'ArrowUp':
                    e.preventDefault()
                    setFocusedIndex(prev => {
                        const next = prev - 1
                        return next < 0 ? models.length - 1 : next
                    })
                    break
                case 'Enter':
                    e.preventDefault()
                    if (focusedIndex >= 0 && focusedIndex < models.length) {
                        handleSelect(models[focusedIndex].value)
                    }
                    break
                case 'Escape':
                    e.preventDefault()
                    setIsOpen(false)
                    setFocusedIndex(-1)
                    break
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [isOpen, focusedIndex, models, handleSelect])
    
    const selectedAvailable = isAvailable(selectedModel.value)
    const selectedDisabled = disabled || (!selectedAvailable && !loading)
    
    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
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
            >
                <span className="flex items-center gap-2">
                    {loading ? (
                        <span className="inline-block h-2 w-2 animate-spin rounded-full border border-current border-t-transparent" />
                    ) : (
                        <span className={`w-2 h-2 rounded-full ${
                            selectedModel.color === 'blue' ? 'bg-blue-500' : 
                            selectedModel.color === 'purple' ? 'bg-purple-500' : 
                            selectedModel.color === 'green' ? 'bg-green-500' : 
                            selectedModel.color === 'orange' ? 'bg-orange-500' :
                            selectedModel.color === 'cyan' ? 'bg-cyan-500' : 'bg-red-500'
                        } ${!selectedAvailable && !loading ? 'opacity-50' : ''}`} />
                    )}
                    <span className="flex items-center gap-1">
                        {selectedModel.label}
                        {!loading && !selectedAvailable && (
                            <svg 
                                className="w-3 h-3" 
                                style={{ color: theme.colors.status.warning }} 
                                fill="none" 
                                stroke="currentColor" 
                                viewBox="0 0 24 24"
                            >
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                            </svg>
                        )}
                    </span>
                </span>
                <svg 
                    className="w-4 h-4" 
                    style={{ color: theme.colors.text.muted }}
                    fill="none" 
                    stroke="currentColor" 
                    viewBox="0 0 24 24"
                >
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
            </button>
            
            {isOpen && !disabled && (
                <>
                    <div 
                        className="fixed inset-0 z-40" 
                        onClick={() => {
                            setIsOpen(false)
                            setFocusedIndex(-1)
                        }}
                    />
                    <div 
                        ref={dropdownRef} 
                        className="absolute top-full left-0 right-0 mt-1 rounded shadow-lg z-50"
                        style={{ 
                            backgroundColor: theme.colors.background.elevated,
                            borderColor: theme.colors.border.default,
                            border: '1px solid'
                        }}
                    >
                        {models.map((model, index) => {
                            const available = isAvailable(model.value)
                            const canSelect = available || loading
                            
                            return (
                                <button
                                    key={model.value}
                                    type="button"
                                    onClick={() => handleSelect(model.value)}
                                    disabled={!canSelect}
                                    className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 ${
                                        !canSelect 
                                            ? 'cursor-not-allowed opacity-50' 
                                            : 'cursor-pointer'
                                    } ${
                                        index === focusedIndex && canSelect 
                                            ? 'opacity-80' 
                                            : model.value === value 
                                            ? 'opacity-90' 
                                            : canSelect
                                            ? 'hover:opacity-80'
                                            : ''
                                    }`}
                                    style={{
                                        backgroundColor: 
                                            index === focusedIndex && canSelect 
                                                ? theme.colors.background.hover
                                                : model.value === value
                                                ? theme.colors.background.active
                                                : 'transparent',
                                        color: !canSelect && !loading ? theme.colors.text.muted : theme.colors.text.primary
                                    }}
                                    title={getTooltipText(model.value)}
                                >
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
                                            <svg 
                                                className="w-3 h-3" 
                                                style={{ color: theme.colors.status.warning }} 
                                                fill="none" 
                                                stroke="currentColor" 
                                                viewBox="0 0 24 24"
                                            >
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
                                            </svg>
                                        )}
                                    </span>
                                </button>
                            )
                        })}
                    </div>
                </>
            )}
        </div>
    )
}