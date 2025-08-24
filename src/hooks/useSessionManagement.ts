import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

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
    resetSession: (selection: SessionSelection, terminals: TerminalIds) => Promise<void>
    switchModel: (
        agentType: string, 
        selection: SessionSelection, 
        terminals: TerminalIds,
        clearTerminalTracking: (terminalIds: string[]) => Promise<void>,
        clearTerminalStartedTracking: (terminalIds: string[]) => void
    ) => Promise<void>
}

export function useSessionManagement(): SessionManagementHookReturn {
    const [isResetting, setIsResetting] = useState(false)

    const resetOrchestratorTerminal = useCallback(async (terminalId: string): Promise<void> => {
        await invoke('para_core_reset_orchestrator', { terminalId })
    }, [])

    const closeTerminalIfExists = useCallback(async (terminalId: string): Promise<void> => {
        const exists = await invoke<boolean>('terminal_exists', { id: terminalId })
        if (exists) {
            await invoke('close_terminal', { id: terminalId })
        }
    }, [])

    const restartClaudeInSession = useCallback(async (sessionName: string): Promise<void> => {
        await invoke('para_core_start_claude', { sessionName })
    }, [])

    const waitForTerminalCleanup = useCallback(async (): Promise<void> => {
        await new Promise(resolve => setTimeout(resolve, 200))
    }, [])

    const notifyTerminalsReset = useCallback((): void => {
        window.dispatchEvent(new Event('schaltwerk:reset-terminals'))
    }, [])

    const waitForResetCompletion = useCallback(async (): Promise<void> => {
        await new Promise(resolve => setTimeout(resolve, 500))
    }, [])

    const resetSessionTerminals = useCallback(async (
        sessionName: string, 
        terminalId: string
    ): Promise<void> => {
        await closeTerminalIfExists(terminalId)
        await waitForTerminalCleanup()
        await restartClaudeInSession(sessionName)
    }, [closeTerminalIfExists, waitForTerminalCleanup, restartClaudeInSession])

    const resetSession = useCallback(async (
        selection: SessionSelection, 
        terminals: TerminalIds
    ): Promise<void> => {
        if (isResetting) return
        
        try {
            setIsResetting(true)
            
            if (selection.kind === 'orchestrator') {
                await resetOrchestratorTerminal(terminals.top)
            } else if (selection.kind === 'session' && selection.payload) {
                await resetSessionTerminals(selection.payload, terminals.top)
            }
            
            notifyTerminalsReset()
            await waitForResetCompletion()
            
        } finally {
            setIsResetting(false)
        }
    }, [isResetting, resetOrchestratorTerminal, resetSessionTerminals, notifyTerminalsReset, waitForResetCompletion])

    const updateAgentTypeForSession = useCallback(async (
        sessionName: string, 
        agentType: string
    ): Promise<void> => {
        await invoke('para_core_set_session_agent_type', { sessionName, agentType })
    }, [])

    const updateGlobalAgentType = useCallback(async (agentType: string): Promise<void> => {
        await invoke('para_core_set_agent_type', { agentType })
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
        await waitForTerminalCleanup()
    }, [closeTerminalIfExists, waitForTerminalCleanup])

    const startOrchestratorWithNewModel = useCallback(async (terminalId: string): Promise<void> => {
        await invoke('para_core_start_claude_orchestrator', { terminalId })
    }, [])

    const startSessionWithNewModel = useCallback(async (sessionName: string): Promise<void> => {
        await invoke('para_core_start_claude', { sessionName })
    }, [])

    const restartWithNewModel = useCallback(async (
        selection: SessionSelection, 
        terminalId: string
    ): Promise<void> => {
        if (selection.kind === 'orchestrator') {
            await startOrchestratorWithNewModel(terminalId)
        } else if (selection.kind === 'session' && selection.payload) {
            await startSessionWithNewModel(selection.payload)
        }
    }, [startOrchestratorWithNewModel, startSessionWithNewModel])

    const switchModel = useCallback(async (
        agentType: string,
        selection: SessionSelection,
        terminals: TerminalIds,
        clearTerminalTracking: (terminalIds: string[]) => Promise<void>,
        clearTerminalStartedTracking: (terminalIds: string[]) => void
    ): Promise<void> => {
        await updateAgentType(selection, agentType)
        
        const claudeTerminalId = terminals.top
        await clearTerminalState(claudeTerminalId, clearTerminalTracking, clearTerminalStartedTracking)
        await restartWithNewModel(selection, claudeTerminalId)
        
        notifyTerminalsReset()
    }, [updateAgentType, clearTerminalState, restartWithNewModel, notifyTerminalsReset])

    return {
        isResetting,
        resetSession,
        switchModel
    }
}