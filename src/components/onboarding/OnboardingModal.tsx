import { useState, useEffect, useCallback } from 'react'
import { ONBOARDING_STEPS } from './steps'
import { logger } from '../../utils/logger'

function SmartModalOverlay({ highlightElement, highlightRect }: { highlightElement: Element | null, highlightRect: DOMRect | null }) {
    if (!highlightElement || !highlightRect) {
        return <div className="absolute inset-0 bg-black/60 -z-10" />
    }

    const rect = highlightRect
    const padding = 12
    
    return (
        <div className="absolute inset-0 -z-10">
            <div 
                className="absolute bg-black/60"
                style={{
                    top: 0,
                    left: 0,
                    right: 0,
                    height: Math.max(0, rect.top - padding),
                }}
            />
            <div 
                className="absolute bg-black/60"
                style={{
                    bottom: 0,
                    left: 0,
                    right: 0,
                    height: Math.max(0, window.innerHeight - (rect.bottom + padding)),
                }}
            />
            <div 
                className="absolute bg-black/60"
                style={{
                    top: Math.max(0, rect.top - padding),
                    bottom: Math.max(0, window.innerHeight - (rect.bottom + padding)),
                    left: 0,
                    width: Math.max(0, rect.left - padding),
                }}
            />
            <div 
                className="absolute bg-black/60"
                style={{
                    top: Math.max(0, rect.top - padding),
                    bottom: Math.max(0, window.innerHeight - (rect.bottom + padding)),
                    right: 0,
                    width: Math.max(0, window.innerWidth - (rect.right + padding)),
                }}
            />
        </div>
    )
}

function HighlightCutout({ highlightRect }: { highlightRect: DOMRect | null }) {
    if (!highlightRect) return null
    
    const rect = highlightRect
    const padding = 8
    
    return (
        <>
            <div 
                className="absolute border-4 border-blue-400 rounded-lg shadow-lg shadow-blue-400/50 bg-transparent animate-pulse"
                style={{
                    left: rect.left - padding,
                    top: rect.top - padding,
                    width: rect.width + (padding * 2),
                    height: rect.height + (padding * 2),
                    zIndex: 51,
                }}
            />
            <div 
                className="absolute bg-blue-400/20 rounded-lg"
                style={{
                    left: rect.left - padding * 1.5,
                    top: rect.top - padding * 1.5,
                    width: rect.width + (padding * 3),
                    height: rect.height + (padding * 3),
                    zIndex: 50,
                }}
            />
        </>
    )
}

interface Props {
    open: boolean
    onClose: () => void
    onComplete: () => void
}

export function OnboardingModal({ open, onClose, onComplete }: Props) {
    const [currentStep, setCurrentStep] = useState(0)
    const [highlightElement, setHighlightElement] = useState<Element | null>(null)
    const [highlightRect, setHighlightRect] = useState<DOMRect | null>(null)

    const step = ONBOARDING_STEPS[currentStep]
    const isLastStep = currentStep === ONBOARDING_STEPS.length - 1

    useEffect(() => {
        if (!open) {
            setCurrentStep(0)
            setHighlightElement(null)
            setHighlightRect(null)
            return
        }

        const currentStepData = ONBOARDING_STEPS[currentStep]
        if (currentStepData?.highlight) {
            const timer = setTimeout(() => {
                const element = document.querySelector(currentStepData.highlight!)
                if (element) {
                    setHighlightElement(element)
                    setHighlightRect(element.getBoundingClientRect())
                    
                    element.scrollIntoView({ 
                        behavior: 'smooth', 
                        block: 'center',
                        inline: 'center' 
                    })
                    
                    setTimeout(() => {
                        setHighlightRect(element.getBoundingClientRect())
                    }, 300)
                } else {
                    logger.warn(`Highlight element not found: ${currentStepData.highlight}`)
                    setHighlightElement(null)
                    setHighlightRect(null)
                }
            }, 100)
            
            return () => clearTimeout(timer)
        } else {
            setHighlightElement(null)
            setHighlightRect(null)
        }
    }, [open, currentStep])

    const handleNext = useCallback(() => {
        if (isLastStep) {
            handleComplete()
        } else {
            setCurrentStep(prev => prev + 1)
        }
    }, [isLastStep])

    const handlePrevious = useCallback(() => {
        if (currentStep > 0) {
            setCurrentStep(prev => prev - 1)
        }
    }, [currentStep])

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
            } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
                e.preventDefault()
                handleNext()
            } else if (e.key === 'ArrowLeft') {
                e.preventDefault()
                handlePrevious()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open, currentStep, isLastStep, handleNext, handlePrevious, onClose])

    const handleComplete = () => {
        onComplete()
        onClose()
    }

    const handleSkip = () => {
        onComplete()
        onClose()
    }

    if (!open) return null

    return (
        <>
            <div className="fixed inset-0 z-50 flex items-center justify-center">
                <SmartModalOverlay highlightElement={highlightElement} highlightRect={highlightRect} />
                
                {highlightElement && <HighlightCutout highlightRect={highlightRect} />}
                
                <div className="w-[600px] max-w-[90vw] bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden relative z-40">
                    <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between">
                        <div className="flex items-center gap-3">
                            <div className="w-8 h-8 bg-blue-600 rounded-lg flex items-center justify-center">
                                <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                </svg>
                            </div>
                            <div>
                                <h2 className="text-lg font-semibold text-slate-200">{step.title}</h2>
                                <div className="text-sm text-slate-400">
                                    Step {currentStep + 1} of {ONBOARDING_STEPS.length}
                                </div>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="text-slate-400 hover:text-slate-200 transition-colors p-1"
                        >
                            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>

                    <div className="h-1 bg-slate-800">
                        <div 
                            className="h-full bg-blue-500 transition-all duration-300"
                            style={{ width: `${((currentStep + 1) / ONBOARDING_STEPS.length) * 100}%` }}
                        />
                    </div>

                    <div className="px-6 py-6 text-slate-300">
                        {step.content}
                    </div>

                    <div className="px-6 py-4 border-t border-slate-800 flex items-center justify-between">
                        <button
                            onClick={handleSkip}
                            className="text-slate-400 hover:text-slate-300 text-sm transition-colors"
                        >
                            Skip tutorial
                        </button>
                        
                        <div className="flex items-center gap-2">
                            <button
                                onClick={handlePrevious}
                                disabled={currentStep === 0}
                                className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 rounded text-sm transition-colors text-slate-300"
                            >
                                Previous
                            </button>
                            <button
                                onClick={handleNext}
                                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded text-sm transition-colors flex items-center gap-2"
                            >
                                {isLastStep ? 'Get Started' : 'Next'}
                                {!isLastStep && (
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                    </svg>
                                )}
                            </button>
                        </div>
                    </div>

                    <div className="px-6 pb-3">
                        <div className="text-xs text-slate-500 text-center">
                            Use <kbd className="px-1 py-0.5 bg-slate-700 rounded">←</kbd> <kbd className="px-1 py-0.5 bg-slate-700 rounded">→</kbd> or <kbd className="px-1 py-0.5 bg-slate-700 rounded">Enter</kbd> to navigate • <kbd className="px-1 py-0.5 bg-slate-700 rounded">Esc</kbd> to close
                        </div>
                    </div>
                </div>
            </div>
        </>
    )
}