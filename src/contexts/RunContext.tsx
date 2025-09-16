import { createContext, useContext, useState, useEffect, ReactNode } from 'react'
import { useSessions } from './SessionsContext'
import { isRunning } from '../utils/sessionFilters'

interface RunContextType {
    runningSessions: Set<string>
    addRunningSession: (sessionId: string) => void
    removeRunningSession: (sessionId: string) => void
    isSessionRunning: (sessionId: string) => boolean
}

const RunContext = createContext<RunContextType | undefined>(undefined)

export function RunProvider({ children }: { children: ReactNode }) {
    const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set())
    const { allSessions } = useSessions()

    const addRunningSession = (sessionId: string) => {
        setRunningSessions(prev => new Set(prev).add(sessionId))
    }

    const removeRunningSession = (sessionId: string) => {
        setRunningSessions(prev => {
            const next = new Set(prev)
            next.delete(sessionId)
            return next
        })
    }

    const isSessionRunning = (sessionId: string) => {
        return runningSessions.has(sessionId)
    }

    useEffect(() => {
        setRunningSessions(prev => {
            if (!allSessions || allSessions.length === 0) {
                if (prev.size === 0) return prev
                const next = new Set<string>()
                // Preserve orchestrator flag if active
                if (prev.has('orchestrator')) next.add('orchestrator')
                return next.size === prev.size ? prev : next
            }

            const allowed = new Set<string>(
                allSessions
                    .filter(session => isRunning(session.info))
                    .map(session => session.info.session_id)
            )

            let changed = false
            const next = new Set<string>()
            prev.forEach(id => {
                if (id === 'orchestrator' || allowed.has(id)) {
                    next.add(id)
                } else {
                    changed = true
                }
            })

            return changed || next.size !== prev.size ? next : prev
        })
    }, [allSessions])

    return (
        <RunContext.Provider value={{ 
            runningSessions, 
            addRunningSession, 
            removeRunningSession, 
            isSessionRunning 
        }}>
            {children}
        </RunContext.Provider>
    )
}

export function useRun() {
    const context = useContext(RunContext)
    if (!context) {
        throw new Error('useRun must be used within a RunProvider')
    }
    return context
}
