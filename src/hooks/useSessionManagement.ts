import { useState, useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { SchaltEvent, listenEvent } from '../common/eventSystem'
import { TerminalResetDetail, createTerminalResetEvent } from '../types/terminalEvents'

export interface SessionSelection {
    kind: 'orchestrator' | 'session'
    payload?: string
}

export interface TerminalIds {
    top: string
    bottomBase: string
}

export interface SessionManagementHookReturn {
    isResetting: boolean
    resettingSelection: SessionSelection | null
    resetSession: (selection: SessionSelection, terminals: TerminalIds) => Promise<void>
    switchModel: (
        agentType: string,
        skipPermissions: boolean,
        selection: SessionSelection,
        terminals: TerminalIds,
        clearTerminalTracking: (terminalIds: string[]) => Promise<void>,
        clearTerminalStartedTracking: (terminalIds: string[]) => void
    ) => Promise<void>
}

export function useSessionManagement(): SessionManagementHookReturn {
    const [resettingSelection, setResettingSelection] = useState<SessionSelection | null>(null)
    const isResetting = resettingSelection !== null

    const resetOrchestratorTerminal = useCallback(async (terminalId: string): Promise<void> => {
        await invoke(TauriCommands.SchaltwerkCoreResetOrchestrator, { terminalId })
    }, [])

    const closeTerminalIfExists = useCallback(async (terminalId: string): Promise<void> => {
        // Assume existence when we already checked; backend is resilient to idempotent close
        await invoke(TauriCommands.CloseTerminal, { id: terminalId })
    }, [])

    const restartClaudeInSession = useCallback(async (sessionName: string): Promise<void> => {
        await invoke(TauriCommands.SchaltwerkCoreStartClaudeWithRestart, { sessionName, forceRestart: true })
    }, [])

    const waitForTerminalClosed = useCallback(async (terminalId: string): Promise<void> => {
        await new Promise<void>((resolve) => {
            let stop: (() => void) | null = null
            let resolved = false
            const handler = (payload: { terminal_id: string }) => {
                if (payload.terminal_id === terminalId && !resolved) {
                    resolved = true
                    if (stop) stop()
                    resolve()
                }
            }
            listenEvent(SchaltEvent.TerminalClosed, handler).then((unlisten) => {
                stop = unlisten
            })
            // Deterministic RAF fallback to avoid deadlocks in tests without backend events
            let frames = 3
            const tick = () => {
                if (resolved) return
                if (frames-- <= 0) {
                    if (stop) stop()
                    resolved = true
                    resolve()
                    return
                }
                requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
        })
    }, [])

    const notifyTerminalsReset = useCallback((detail: TerminalResetDetail): void => {
        window.dispatchEvent(createTerminalResetEvent(detail))
    }, [])

    const waitForAgentStarted = useCallback(async (terminalId: string): Promise<void> => {
        await new Promise<void>((resolve) => {
            let stop: (() => void) | null = null
            let resolved = false
            const handler = (payload: { terminal_id: string }) => {
                if (payload.terminal_id === terminalId && !resolved) {
                    resolved = true
                    if (stop) stop()
                    resolve()
                }
            }
            listenEvent(SchaltEvent.TerminalAgentStarted, handler).then((unlisten) => {
                stop = unlisten
            })
            let frames = 3
            const tick = () => {
                if (resolved) return
                if (frames-- <= 0) {
                    if (stop) stop()
                    resolved = true
                    resolve()
                    return
                }
                requestAnimationFrame(tick)
            }
            requestAnimationFrame(tick)
        })
    }, [])

    const resetSessionTerminals = useCallback(async (
        sessionName: string, 
        terminalId: string
    ): Promise<void> => {
        const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: terminalId })
        const closedP = exists ? waitForTerminalClosed(terminalId) : Promise.resolve()
        const startedP = waitForAgentStarted(terminalId)
        if (exists) {
            await closeTerminalIfExists(terminalId)
            await closedP
        }
        await restartClaudeInSession(sessionName)
        await startedP
    }, [closeTerminalIfExists, waitForTerminalClosed, restartClaudeInSession, waitForAgentStarted])

    const resetSession = useCallback(async (
        selection: SessionSelection, 
        terminals: TerminalIds
    ): Promise<void> => {
        if (isResetting) return

        try {
            setResettingSelection(selection.kind === 'session' && selection.payload
                ? { kind: 'session', payload: selection.payload }
                : { kind: selection.kind })
            
            let resetDetail: TerminalResetDetail = { kind: 'orchestrator' }

            if (selection.kind === 'orchestrator') {
                const closedP = waitForTerminalClosed(terminals.top)
                const startedP = waitForAgentStarted(terminals.top)
                await resetOrchestratorTerminal(terminals.top)
                await closedP
                await startedP
            } else if (selection.kind === 'session' && selection.payload) {
                await resetSessionTerminals(selection.payload, terminals.top)
                resetDetail = { kind: 'session', sessionId: selection.payload }
            }
            
            notifyTerminalsReset(resetDetail)
            
        } finally {
            setResettingSelection(null)
        }
    }, [isResetting, resetOrchestratorTerminal, resetSessionTerminals, notifyTerminalsReset, waitForAgentStarted, waitForTerminalClosed])

    const updateAgentTypeForSession = useCallback(async (
        sessionName: string, 
        agentType: string
    ): Promise<void> => {
        await invoke(TauriCommands.SchaltwerkCoreSetSessionAgentType, { sessionName, agentType })
    }, [])

    const updateGlobalAgentType = useCallback(async (agentType: string): Promise<void> => {
        await invoke(TauriCommands.SchaltwerkCoreSetAgentType, { agentType })
    }, [])

    const updateAgentType = useCallback(async (
        selection: SessionSelection, 
        agentType: string
    ): Promise<void> => {
        if (selection.kind === 'session' && selection.payload) {
            await updateAgentTypeForSession(selection.payload, agentType)
        } else {
            await updateGlobalAgentType(agentType)
        }
    }, [updateAgentTypeForSession, updateGlobalAgentType])

    const clearTerminalState = useCallback(async (
        terminalId: string,
        clearTerminalTracking: (terminalIds: string[]) => Promise<void>,
        clearTerminalStartedTracking: (terminalIds: string[]) => void
    ): Promise<void> => {
        await closeTerminalIfExists(terminalId)
        await clearTerminalTracking([terminalId])
        clearTerminalStartedTracking([terminalId])
        await waitForTerminalClosed(terminalId)
    }, [closeTerminalIfExists, waitForTerminalClosed])

    const startOrchestratorWithNewModel = useCallback(async (terminalId: string): Promise<void> => {
        await invoke(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, { terminalId })
    }, [])

    const startSessionWithNewModel = useCallback(async (sessionName: string): Promise<void> => {
        await invoke(TauriCommands.SchaltwerkCoreStartClaudeWithRestart, { sessionName, forceRestart: true })
    }, [])

    const restartWithNewModel = useCallback(async (
        selection: SessionSelection, 
        terminalId: string
    ): Promise<void> => {
        if (selection.kind === 'orchestrator') {
            const startedP = waitForAgentStarted(terminalId)
            await startOrchestratorWithNewModel(terminalId)
            await startedP
        } else if (selection.kind === 'session' && selection.payload) {
            const startedP = waitForAgentStarted(terminalId)
            await startSessionWithNewModel(selection.payload)
            await startedP
        }
    }, [startOrchestratorWithNewModel, startSessionWithNewModel, waitForAgentStarted])

    const switchModel = useCallback(async (
        agentType: string,
        skipPermissions: boolean,
        selection: SessionSelection,
        terminals: TerminalIds,
        clearTerminalTracking: (terminalIds: string[]) => Promise<void>,
        clearTerminalStartedTracking: (terminalIds: string[]) => void
    ): Promise<void> => {
        await invoke(TauriCommands.SchaltwerkCoreSetSkipPermissions, { enabled: skipPermissions })
        await updateAgentType(selection, agentType)
        
        const claudeTerminalId = terminals.top
        const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: claudeTerminalId })
        if (exists) {
            await clearTerminalState(claudeTerminalId, clearTerminalTracking, clearTerminalStartedTracking)
        } else {
            // Still clear front-end tracking even if terminal doesn't exist
            await clearTerminalTracking([claudeTerminalId])
            clearTerminalStartedTracking([claudeTerminalId])
        }
        await restartWithNewModel(selection, claudeTerminalId)
        
        const resetDetail: TerminalResetDetail = selection.kind === 'session' && selection.payload
            ? { kind: 'session', sessionId: selection.payload }
            : { kind: 'orchestrator' }

        notifyTerminalsReset(resetDetail)
    }, [updateAgentType, clearTerminalState, restartWithNewModel, notifyTerminalsReset])

    return {
        isResetting,
        resettingSelection,
        resetSession,
        switchModel
    }
}
