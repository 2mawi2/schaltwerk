import { useState, useEffect, useRef, useCallback } from 'react'
import { getLongestCommonPrefix } from '../../utils/stringUtils'

interface BranchAutocompleteProps {
    value: string
    onChange: (value: string) => void
    branches: string[]
    disabled?: boolean
    placeholder?: string
    className?: string
    onValidationChange?: (isValid: boolean) => void
}

export function BranchAutocomplete({
    value,
    onChange,
    branches,
    disabled = false,
    placeholder = "Type to search branches...",
    className = "",
    onValidationChange
}: BranchAutocompleteProps) {
    const [isOpen, setIsOpen] = useState(false)
    const [filteredBranches, setFilteredBranches] = useState<string[]>([])
    const [highlightedIndex, setHighlightedIndex] = useState(-1)
    const [showValidationError, setShowValidationError] = useState(false)
    const inputRef = useRef<HTMLInputElement>(null)
    const dropdownRef = useRef<HTMLDivElement>(null)
    const itemRefs = useRef<(HTMLDivElement | null)[]>([])

    // Filter branches based on input
    useEffect(() => {
        if (!value || typeof value !== 'string') {
            setFilteredBranches(branches.slice(0, 10)) // Show first 10 when empty
        } else {
            const searchTerm = value.toLowerCase()
            const filtered = branches
                .filter(branch => branch.toLowerCase().includes(searchTerm))
                .sort((a, b) => {
                    // Prioritize exact matches
                    const aExact = a.toLowerCase() === searchTerm
                    const bExact = b.toLowerCase() === searchTerm
                    if (aExact && !bExact) {
                        return -1
                    }
                    if (!aExact && bExact) {
                        return 1
                    }

                    // Then prioritize starts with
                    const aStarts = a.toLowerCase().startsWith(searchTerm)
                    const bStarts = b.toLowerCase().startsWith(searchTerm)
                    if (aStarts && !bStarts) {
                        return -1
                    }
                    if (!aStarts && bStarts) {
                        return 1
                    }

                    // Finally sort alphabetically
                    return a.localeCompare(b)
                })
                .slice(0, 20) // Limit to 20 results
            setFilteredBranches(filtered)
        }
    }, [value, branches])

    // Notify parent about validation status
    useEffect(() => {
        if (onValidationChange) {
            const isValid = !value || branches.includes(value)
            onValidationChange(isValid)
        }
    }, [value, branches, onValidationChange])

    // Handle clicking outside
    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (
                dropdownRef.current &&
                !dropdownRef.current.contains(event.target as Node) &&
                inputRef.current &&
                !inputRef.current.contains(event.target as Node)
            ) {
                setIsOpen(false)
            }
        }

        document.addEventListener('mousedown', handleClickOutside)
        return () => document.removeEventListener('mousedown', handleClickOutside)
    }, [])

    // Scroll highlighted item into view
    useEffect(() => {
        if (highlightedIndex >= 0 && highlightedIndex < itemRefs.current.length) {
            itemRefs.current[highlightedIndex]?.scrollIntoView({
                block: 'nearest',
                behavior: 'smooth'
            })
        }
    }, [highlightedIndex])

    const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
        if (e.key === 'ArrowDown') {
            e.preventDefault()
            setIsOpen(true)
            setHighlightedIndex(prev => 
                prev < filteredBranches.length - 1 ? prev + 1 : 0
            )
        } else if (e.key === 'ArrowUp') {
            e.preventDefault()
            setIsOpen(true)
            setHighlightedIndex(prev => 
                prev > 0 ? prev - 1 : filteredBranches.length - 1
            )
        } else if (e.key === 'Enter') {
            e.preventDefault()
            if (highlightedIndex >= 0 && highlightedIndex < filteredBranches.length) {
                onChange(filteredBranches[highlightedIndex])
                setIsOpen(false)
                setHighlightedIndex(-1)
            } else if (filteredBranches.length === 1) {
                onChange(filteredBranches[0])
                setIsOpen(false)
                setHighlightedIndex(-1)
            }
        } else if (e.key === 'Escape') {
            setIsOpen(false)
            setHighlightedIndex(-1)
        } else if (e.key === 'Tab') {
            e.preventDefault()
            if (filteredBranches.length === 0) {
                return
            }

            // If only one match, accept it
            if (filteredBranches.length === 1) {
                onChange(filteredBranches[0])
                setIsOpen(false)
                setHighlightedIndex(-1)
                return
            }

            // If multiple matches, complete to longest common prefix
            if (filteredBranches.length > 1) {
                const prefix = getLongestCommonPrefix(filteredBranches)
                if (prefix.length > value.length) {
                    onChange(prefix)
                    // Keep dropdown open for further completion
                    setHighlightedIndex(0)
                } else {
                    // If already at longest common prefix, accept first match
                    onChange(filteredBranches[0])
                    setIsOpen(false)
                    setHighlightedIndex(-1)
                }
            }
        } else if (e.ctrlKey && e.key === ' ') {
            // Ctrl+Space to show all branches
            e.preventDefault()
            setIsOpen(true)
            setFilteredBranches(branches.slice(0, 20))
            setHighlightedIndex(0)
        }
    }, [filteredBranches, highlightedIndex, onChange, branches, value])

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        onChange(e.target.value)
        setIsOpen(true)
        setHighlightedIndex(-1)
        setShowValidationError(false) // Hide error while typing
    }

    const handleBlur = () => {
        // Show validation error only on blur if branch doesn't exist
        if (value && !branches.includes(value)) {
            setShowValidationError(true)
        }
        // Close dropdown after a small delay to allow click events to process
        setTimeout(() => setIsOpen(false), 200)
    }

    const handleSelectBranch = (branch: string) => {
        onChange(branch)
        setIsOpen(false)
        setHighlightedIndex(-1)
        setShowValidationError(false)
        inputRef.current?.focus()
    }

    const highlightMatch = (text: string, query: string) => {
        if (!query) {
            return text
        }
        const parts = text.split(new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'))
        return (
            <>
                {parts.map((part, index) =>
                    part.toLowerCase() === query.toLowerCase() ? (
                        <span key={index} className="text-blue-400 font-semibold">{part}</span>
                    ) : (
                        <span key={index}>{part}</span>
                    )
                )}
            </>
        )
    }

    return (
        <div className="relative">
            <input
                ref={inputRef}
                type="text"
                value={value}
                onChange={handleInputChange}
                onKeyDown={handleKeyDown}
                onFocus={() => {
                    setIsOpen(true)
                    setShowValidationError(false) // Hide error when focusing
                }}
                onBlur={handleBlur}
                disabled={disabled}
                placeholder={placeholder}
                className={`w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border ${
                    value && !branches.includes(value) 
                        ? 'border-red-500 focus:border-red-400' 
                        : 'border-slate-700 focus:border-blue-500'
                } focus:outline-none transition-colors ${className}`}
                autoComplete="off"
                autoCapitalize="off"
                autoCorrect="off"
                spellCheck={false}
            />
            
            {isOpen && filteredBranches.length > 0 && (
                <div
                    ref={dropdownRef}
                    className="absolute z-50 w-full mt-1 bg-slate-800 border border-slate-700 rounded-md shadow-lg max-h-60 overflow-auto"
                >
                    {filteredBranches.map((branch, index) => (
                        <div
                            key={branch}
                            ref={el => { itemRefs.current[index] = el }}
                            className={`px-3 py-2 cursor-pointer transition-colors ${
                                index === highlightedIndex
                                    ? 'bg-slate-700 text-white'
                                    : 'hover:bg-slate-700/50 text-slate-300'
                            }`}
                            onClick={() => handleSelectBranch(branch)}
                            onMouseEnter={() => setHighlightedIndex(index)}
                        >
                            <div className="flex items-center justify-between">
                                <span className="truncate">
                                    {highlightMatch(branch, value)}
                                </span>
                                {branch === branches[0] && (
                                    <span className="text-xs text-slate-500 ml-2">default</span>
                                )}
                            </div>
                        </div>
                    ))}
                    {filteredBranches.length === 0 && value && (
                        <div className="px-3 py-2 text-slate-500 text-sm">
                            No branches found matching "{value}"
                        </div>
                    )}
                </div>
            )}
            
            {showValidationError && value && !branches.includes(value) && (
                <div className="absolute z-50 w-full mt-1 bg-slate-900 border border-red-500/50 rounded-md shadow-lg p-2.5">
                    <div className="text-red-400 text-sm flex items-center gap-2">
                        <svg className="w-4 h-4 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                        </svg>
                        <span>Branch not found</span>
                    </div>
                </div>
            )}
        </div>
    )
}
