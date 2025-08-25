import { useState } from 'react'

interface Props {
    content: string
    position?: 'top' | 'bottom' | 'left' | 'right'
    className?: string
}

export function HelpTooltip({ content, position = 'top', className = '' }: Props) {
    const [isVisible, setIsVisible] = useState(false)

    const positionClasses = {
        top: 'bottom-full left-1/2 transform -translate-x-1/2 mb-2',
        bottom: 'top-full left-1/2 transform -translate-x-1/2 mt-2',
        left: 'right-full top-1/2 transform -translate-y-1/2 mr-2',
        right: 'left-full top-1/2 transform -translate-y-1/2 ml-2'
    }

    const arrowClasses = {
        top: 'absolute top-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-transparent border-t-slate-700',
        bottom: 'absolute bottom-full left-1/2 transform -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-b-4 border-transparent border-b-slate-700',
        left: 'absolute left-full top-1/2 transform -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-l-4 border-transparent border-l-slate-700',
        right: 'absolute right-full top-1/2 transform -translate-y-1/2 w-0 h-0 border-t-4 border-b-4 border-r-4 border-transparent border-r-slate-700'
    }

    return (
        <div className={`relative inline-block ${className}`}>
            <button
                onMouseEnter={() => setIsVisible(true)}
                onMouseLeave={() => setIsVisible(false)}
                onFocus={() => setIsVisible(true)}
                onBlur={() => setIsVisible(false)}
                className="text-slate-400 hover:text-slate-300 transition-colors p-1"
                type="button"
                aria-label="Help"
            >
                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.228 9c.549-1.165 2.03-2 3.772-2 2.21 0 4 1.343 4 3 0 1.4-1.278 2.575-3.006 2.907-.542.104-.994.54-.994 1.093m0 3h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
            </button>

            {isVisible && (
                <div className={`absolute z-50 px-3 py-2 bg-slate-700 text-slate-200 text-sm rounded shadow-lg max-w-xs whitespace-normal ${positionClasses[position]}`}>
                    {content}
                    <div className={arrowClasses[position]} />
                </div>
            )}
        </div>
    )
}