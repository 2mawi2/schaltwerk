import { useEffect } from 'react'

interface KeyboardShortcutsProps {
    onSelectOrchestrator: () => void
    onSelectSession: (index: number) => void
    onCancelSelectedSession?: (immediate: boolean) => void
    onMarkSelectedSessionReady?: () => void
    onSpecSession?: () => void
    sessionCount: number
    onSelectPrevSession?: () => void
    onSelectNextSession?: () => void
    onFocusSidebar?: () => void
    onFocusClaude?: () => void
    onOpenDiffViewer?: () => void
    onFocusTerminal?: () => void
    onSelectPrevProject?: () => void
    onSelectNextProject?: () => void
    onNavigateToPrevFilter?: () => void
    onNavigateToNextFilter?: () => void
    isDiffViewerOpen?: boolean
}

export function useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onMarkSelectedSessionReady, onSpecSession, sessionCount, onSelectPrevSession, onSelectNextSession, onFocusSidebar, onFocusClaude, onOpenDiffViewer, onFocusTerminal, onSelectPrevProject, onSelectNextProject, onNavigateToPrevFilter, onNavigateToNextFilter, isDiffViewerOpen }: KeyboardShortcutsProps) {
    useEffect(() => {
        const handleKeyDown = (event: KeyboardEvent) => {
            const modifierKey = navigator.userAgent.includes('Mac') ? event.metaKey : event.ctrlKey
            
            if (!modifierKey) return
            
            const key = event.key
            
            if (key === '1') {
                event.preventDefault()
                onSelectOrchestrator()
            } else if (key >= '2' && key <= '9') {
                event.preventDefault()
                const sessionIndex = parseInt(key) - 2
                if (sessionIndex < sessionCount) {
                    onSelectSession(sessionIndex)
                }
            } else if (key === 'ArrowUp') {
                if (onSelectPrevSession && !isDiffViewerOpen) {
                    event.preventDefault()
                    onSelectPrevSession()
                }
            } else if (key === 'ArrowDown') {
                if (onSelectNextSession && !isDiffViewerOpen) {
                    event.preventDefault()
                    onSelectNextSession()
                }
            } else if (key === 'ArrowLeft') {
                if (!isDiffViewerOpen) {
                    if (event.shiftKey) {
                        // Cmd+Shift+Left: Switch to previous project
                        if (onSelectPrevProject) {
                            event.preventDefault()
                            onSelectPrevProject()
                        }
                    } else {
                        // Cmd+Left: Navigate to previous filter
                        if (onNavigateToPrevFilter) {
                            event.preventDefault()
                            onNavigateToPrevFilter()
                        }
                    }
                }
            } else if (key === 'ArrowRight') {
                if (!isDiffViewerOpen) {
                    if (event.shiftKey) {
                        // Cmd+Shift+Right: Switch to next project
                        if (onSelectNextProject) {
                            event.preventDefault()
                            onSelectNextProject()
                        }
                    } else {
                        // Cmd+Right: Navigate to next filter
                        if (onNavigateToNextFilter) {
                            event.preventDefault()
                            onNavigateToNextFilter()
                        }
                    }
                }
            } else if (key === 'd' || key === 'D') {
                if (onCancelSelectedSession) {
                    event.preventDefault()
                    const immediate = event.shiftKey === true
                    onCancelSelectedSession(immediate)
                }
            } else if (key === 'g' || key === 'G') {
                if (onOpenDiffViewer) {
                    event.preventDefault()
                    onOpenDiffViewer()
                }
             } else if (key === 'r' || key === 'R') {
                 if (onMarkSelectedSessionReady) {
                     event.preventDefault()
                     onMarkSelectedSessionReady()
                 }
             } else if (key === 's' || key === 'S') {
                 if (onSpecSession && !event.shiftKey) {
                     event.preventDefault()
                     onSpecSession()
                 }
             } else if (key === 't' || key === 'T') {
                if (onFocusClaude) {
                    event.preventDefault()
                    onFocusClaude()
                }
            } else if (key === '/') {
                if (onFocusTerminal) {
                    event.preventDefault()
                    onFocusTerminal()
                }
            }
        }
        
        window.addEventListener('keydown', handleKeyDown, true) // Use capture phase
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true)
        }
    }, [sessionCount, onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onMarkSelectedSessionReady, onSpecSession, onSelectPrevSession, onSelectNextSession, onFocusSidebar, onFocusClaude, onOpenDiffViewer, onFocusTerminal, onSelectPrevProject, onSelectNextProject, onNavigateToPrevFilter, onNavigateToNextFilter, isDiffViewerOpen])
}