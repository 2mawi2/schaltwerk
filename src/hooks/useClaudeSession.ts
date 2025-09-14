import { useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

interface ClaudeSessionOptions {
    sessionName?: string
    isCommander?: boolean
    terminalId?: string
}

export function useClaudeSession() {
    const startClaude = useCallback(async (options: ClaudeSessionOptions = {}) => {
        try {
            if (options.isCommander) {
                await invoke(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, { 
                    terminalId: options.terminalId || 'orchestrator-default-top' 
                })
                return { success: true }
            } else if (options.sessionName) {
                await invoke(TauriCommands.SchaltwerkCoreStartClaude, { sessionName: options.sessionName })
                return { success: true }
            } else {
                logger.error('[useClaudeSession] Invalid Claude session options: must specify either isCommander or sessionName')
                return { success: false, error: 'Invalid options' }
            }
        } catch (error) {
            logger.error('[useClaudeSession] Failed to start Claude:', error)
            return { success: false, error: String(error) }
        }
    }, [])

    const getSkipPermissions = useCallback(async (): Promise<boolean> => {
        try {
            return await invoke<boolean>(TauriCommands.SchaltwerkCoreGetSkipPermissions)
        } catch (error) {
            logger.error('Failed to get skip permissions:', error)
            return false
        }
    }, [])

    const setSkipPermissions = useCallback(async (enabled: boolean): Promise<boolean> => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetSkipPermissions, { enabled })
            return true
        } catch (error) {
            logger.error('Failed to set skip permissions:', error)
            return false
        }
    }, [])

    const getAgentType = useCallback(async (): Promise<string> => {
        try {
            return await invoke<string>(TauriCommands.SchaltwerkCoreGetAgentType)
        } catch (error) {
            logger.error('Failed to get agent type:', error)
            return 'claude'
        }
    }, [])

    const setAgentType = useCallback(async (agentType: string): Promise<boolean> => {
        try {
            await invoke(TauriCommands.SchaltwerkCoreSetAgentType, { agentType })
            return true
        } catch (error) {
            logger.error('Failed to set agent type:', error)
            return false
        }
    }, [])

    return {
        startClaude,
        getSkipPermissions,
        setSkipPermissions,
        getAgentType,
        setAgentType,
    }
}