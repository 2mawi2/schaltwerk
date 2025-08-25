import { useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

interface ClaudeSessionOptions {
    sessionName?: string
    isCommander?: boolean
    terminalId?: string
}

export function useClaudeSession() {
    const startClaude = useCallback(async (options: ClaudeSessionOptions = {}) => {
        try {
            if (options.isCommander) {
                await invoke('para_core_start_claude_orchestrator', { 
                    terminalId: options.terminalId || 'commander-default-top' 
                })
                return { success: true }
            } else if (options.sessionName) {
                await invoke('para_core_start_claude', { sessionName: options.sessionName })
                return { success: true }
            } else {
                console.error('[useClaudeSession] Invalid Claude session options: must specify either isCommander or sessionName')
                return { success: false, error: 'Invalid options' }
            }
        } catch (error) {
            console.error('[useClaudeSession] Failed to start Claude:', error)
            return { success: false, error: String(error) }
        }
    }, [])

    const getSkipPermissions = useCallback(async (): Promise<boolean> => {
        try {
            return await invoke<boolean>('para_core_get_skip_permissions')
        } catch (error) {
            console.error('Failed to get skip permissions:', error)
            return false
        }
    }, [])

    const setSkipPermissions = useCallback(async (enabled: boolean): Promise<boolean> => {
        try {
            await invoke('para_core_set_skip_permissions', { enabled })
            return true
        } catch (error) {
            console.error('Failed to set skip permissions:', error)
            return false
        }
    }, [])

    const getAgentType = useCallback(async (): Promise<string> => {
        try {
            return await invoke<string>('para_core_get_agent_type')
        } catch (error) {
            console.error('Failed to get agent type:', error)
            return 'claude'
        }
    }, [])

    const setAgentType = useCallback(async (agentType: string): Promise<boolean> => {
        try {
            await invoke('para_core_set_agent_type', { agentType })
            return true
        } catch (error) {
            console.error('Failed to set agent type:', error)
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