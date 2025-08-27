import { useEffect } from 'react'

interface KeyboardShortcutsProps {
    onSelectOrchestrator: () => void
    onSelectSession: (index: number) => void
    onCancelSelectedSession?: (immediate: boolean) => void
    onMarkSelectedSessionReady?: () => void
    sessionCount: number
    onSelectPrevSession?: () => void
    onSelectNextSession?: () => void
    onFocusSidebar?: () => void
    onFocusClaude?: () => void
    onOpenDiffViewer?: () => void
    onFocusTerminal?: () => void
    onSelectPrevProject?: () => void
    onSelectNextProject?: () => void
    isDiffViewerOpen?: boolean
}

export function useKeyboardShortcuts({ onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onMarkSelectedSessionReady, sessionCount, onSelectPrevSession, onSelectNextSession, onFocusSidebar, onFocusClaude, onOpenDiffViewer, onFocusTerminal, onSelectPrevProject, onSelectNextProject, isDiffViewerOpen }: KeyboardShortcutsProps) {
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
                // Switch to previous project
                if (onSelectPrevProject && !isDiffViewerOpen) {
                    event.preventDefault()
                    onSelectPrevProject()
                }
            } else if (key === 'ArrowRight') {
                // Switch to next project
                if (onSelectNextProject && !isDiffViewerOpen) {
                    event.preventDefault()
                    onSelectNextProject()
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
        
        window.addEventListener('keydown', handleKeyDown)
        
        return () => {
            window.removeEventListener('keydown', handleKeyDown)
        }
    }, [sessionCount, onSelectOrchestrator, onSelectSession, onCancelSelectedSession, onMarkSelectedSessionReady, onSelectPrevSession, onSelectNextSession, onFocusSidebar, onFocusClaude, onOpenDiffViewer, onFocusTerminal, onSelectPrevProject, onSelectNextProject, isDiffViewerOpen])
}