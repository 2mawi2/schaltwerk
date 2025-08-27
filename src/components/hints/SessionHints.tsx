import { useSelection } from '../../contexts/SelectionContext'
import { useState, useEffect } from 'react'

interface HintMessage {
    id: string
    message: string
    type: 'info' | 'tip' | 'warning' | 'success'
    action?: string
    actionHandler?: () => void
}

export function SessionHints() {
    const { selection } = useSelection()
    const [currentHints, setCurrentHints] = useState<HintMessage[]>([])
    const [dismissedHints, setDismissedHints] = useState<Set<string>>(new Set())

    useEffect(() => {
        const hints = getHintsForSelection(selection)
        setCurrentHints(hints.filter(hint => !dismissedHints.has(hint.id)))
    }, [selection, dismissedHints])

    const dismissHint = (hintId: string) => {
        setDismissedHints(prev => new Set([...prev, hintId]))
        
        localStorage.setItem('schaltwerk-dismissed-hints', JSON.stringify([...dismissedHints, hintId]))
    }

    useEffect(() => {
        try {
            const saved = localStorage.getItem('schaltwerk-dismissed-hints')
            if (saved) {
                const dismissedIds = JSON.parse(saved)
                setDismissedHints(new Set(dismissedIds))
            }
        } catch (e) {
            console.warn('Failed to load dismissed hints:', e)
        }
    }, [])

    if (currentHints.length === 0) return null

    return (
        <div className="p-3 space-y-2">
            {currentHints.map(hint => (
                <HintCard key={hint.id} hint={hint} onDismiss={() => dismissHint(hint.id)} />
            ))}
        </div>
    )
}

function HintCard({ hint, onDismiss }: { hint: HintMessage, onDismiss: () => void }) {
    const typeStyles = {
        info: 'bg-blue-900/30 border-blue-700/50 text-blue-200',
        tip: 'bg-green-900/30 border-green-700/50 text-green-200',
        warning: 'bg-yellow-900/30 border-yellow-700/50 text-yellow-200',
        success: 'bg-emerald-900/30 border-emerald-700/50 text-emerald-200'
    }

    const iconMap = {
        info: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        ),
        tip: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
        ),
        warning: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.99-.833-2.76 0L4.054 15.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
        ),
        success: (
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
        )
    }

    return (
        <div className={`border rounded-lg p-3 ${typeStyles[hint.type]}`}>
            <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                    {iconMap[hint.type]}
                </div>
                <div className="flex-1 min-w-0">
                    <p className="text-sm">{hint.message}</p>
                    {hint.action && hint.actionHandler && (
                        <button
                            onClick={hint.actionHandler}
                            className="mt-2 text-xs underline hover:no-underline"
                        >
                            {hint.action}
                        </button>
                    )}
                </div>
                <button
                    onClick={onDismiss}
                    className="flex-shrink-0 text-current opacity-60 hover:opacity-100 transition-opacity"
                    title="Dismiss hint"
                >
                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>
        </div>
    )
}

function getHintsForSelection(selection: any): HintMessage[] {
    if (!selection) {
        return [{
            id: 'no-selection',
            message: 'Select a session or the orchestrator from the sidebar to get started. Use ⌘N to create a new session.',
            type: 'info'
        }]
    }

    if (selection.kind === 'orchestrator') {
        return [
            {
                id: 'orchestrator-help',
                message: 'You\'re in the Orchestrator. This is your main workspace for project management, git operations, and switching between sessions.',
                type: 'info'
            },
            {
                id: 'orchestrator-create-session',
                message: 'Ready to start working? Create a new session with ⌘N or a plan with ⇧⌘N to begin an AI-assisted agent.',
                type: 'tip'
            }
        ]
    }

    if (selection.kind === 'session') {
        const hints: HintMessage[] = []

        if (selection.sessionState === 'plan') {
            hints.push({
                id: 'plan-help',
                message: 'This is a plan session. Use it to plan your agent and gather requirements before starting the AI agent.',
                type: 'info'
            })
            hints.push({
                id: 'plan-start',
                message: 'When you\'re ready, click "Start Agent" or press ⌘Enter to begin working with the AI agent.',
                type: 'tip'
            })
        } else if (selection.sessionState === 'running') {
            hints.push({
                id: 'session-running',
                message: 'Your AI agent is working on this agent. You can interact with it and monitor progress in real-time.',
                type: 'success'
            })
            hints.push({
                id: 'session-terminals',
                message: 'Use the bottom terminals for additional commands while the AI agent works in the center panel. Switch focus with ⌘/ for terminals and ⌘T for the agent.',
                type: 'tip'
            })
        } else if (selection.sessionState === 'ready_for_review') {
            hints.push({
                id: 'ready-for-review',
                message: 'The session is ready for review! Check the changes in the right panel and use ⌘G to open the diff viewer.',
                type: 'success'
            })
            hints.push({
                id: 'review-actions',
                message: 'After reviewing, you can finish the session, request changes, or continue working.',
                type: 'info'
            })
        }

        return hints
    }

    return []
}