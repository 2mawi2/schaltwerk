import { useState, useEffect, useRef } from 'react'

interface ModelSelectorProps {
    value: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex'
    onChange: (value: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex') => void
    disabled?: boolean
}

export function ModelSelector({ value, onChange, disabled = false }: ModelSelectorProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [focusedIndex, setFocusedIndex] = useState(-1)
    const dropdownRef = useRef<HTMLDivElement>(null)
    
    const models: Array<{ value: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex', label: string, color: string }> = [
        { value: 'claude', label: 'Claude', color: 'blue' },
        { value: 'cursor', label: 'Cursor', color: 'purple' },
        { value: 'opencode', label: 'OpenCode', color: 'green' },
        { value: 'gemini', label: 'Gemini', color: 'orange' },
        { value: 'codex', label: 'Codex', color: 'red' }
    ]
    
    const selectedModel = models.find(m => m.value === value) || models[0]
    
    const handleSelect = (modelValue: 'claude' | 'cursor' | 'opencode' | 'gemini' | 'codex') => {
        onChange(modelValue)
        setIsOpen(false)
        setFocusedIndex(-1)
    }

    useEffect(() => {
        if (isOpen) {
            const currentIndex = models.findIndex(m => m.value === value)
            setFocusedIndex(currentIndex >= 0 ? currentIndex : 0)
        }
    }, [isOpen, value])

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
    }, [isOpen, focusedIndex, models])
    
    return (
        <div className="relative">
            <button
                type="button"
                onClick={() => !disabled && setIsOpen(!isOpen)}
                disabled={disabled}
                className={`w-full px-3 py-1.5 text-sm rounded border flex items-center justify-between ${
                    disabled 
                        ? 'bg-slate-800 border-slate-700 text-slate-500 cursor-not-allowed' 
                        : 'bg-slate-800 border-slate-700 text-slate-200 hover:bg-slate-750 cursor-pointer'
                }`}
            >
                <span className="flex items-center gap-2">
                    <span className={`w-2 h-2 rounded-full ${
                        selectedModel.color === 'blue' ? 'bg-blue-500' : 
                        selectedModel.color === 'purple' ? 'bg-purple-500' : 
                        selectedModel.color === 'green' ? 'bg-green-500' : 
                        selectedModel.color === 'orange' ? 'bg-orange-500' : 'bg-red-500'
                    }`} />
                    {selectedModel.label}
                </span>
                <svg className="w-4 h-4 text-slate-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
                    <div ref={dropdownRef} className="absolute top-full left-0 right-0 mt-1 bg-slate-800 border border-slate-700 rounded shadow-lg z-50">
                        {models.map((model, index) => (
                            <button
                                key={model.value}
                                type="button"
                                onClick={() => handleSelect(model.value)}
                                className={`w-full px-3 py-2 text-sm text-left flex items-center gap-2 hover:bg-slate-700 ${
                                    index === focusedIndex ? 'bg-slate-600' : 
                                    model.value === value ? 'bg-slate-700' : ''
                                }`}
                            >
                                <span className={`w-2 h-2 rounded-full ${
                                    model.color === 'blue' ? 'bg-blue-500' : 
                                    model.color === 'purple' ? 'bg-purple-500' : 
                                    model.color === 'green' ? 'bg-green-500' : 
                                    model.color === 'orange' ? 'bg-orange-500' : 'bg-red-500'
                                }`} />
                                {model.label}
                            </button>
                        ))}
                    </div>
                </>
            )}
        </div>
    )
}