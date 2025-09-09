import { createContext, useContext, useState, ReactNode } from 'react'

interface RunContextType {
    runningSessions: Set<string>
    addRunningSession: (sessionId: string) => void
    removeRunningSession: (sessionId: string) => void
    isSessionRunning: (sessionId: string) => boolean
}

const RunContext = createContext<RunContextType | undefined>(undefined)

export function RunProvider({ children }: { children: ReactNode }) {
    const [runningSessions, setRunningSessions] = useState<Set<string>>(new Set())

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