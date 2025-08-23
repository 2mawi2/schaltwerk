import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'

export type AgentType = 'claude' | 'cursor-agent' | 'opencode' | 'gemini' | 'codex'
type EnvVars = Record<string, string>

interface ProjectSettings {
    setupScript: string
    environmentVariables: Array<{key: string, value: string}>
}

interface TerminalSettings {
    shell: string | null
    shellArgs: string[]
}

export interface SettingsSaveResult {
    success: boolean
    savedSettings: string[]
    failedSettings: string[]
}

export const useSettings = () => {
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)
    
    const saveAgentSettings = useCallback(async (
        envVars: Record<AgentType, Array<{key: string, value: string}>>,
        cliArgs: Record<AgentType, string>
    ): Promise<void> => {
        const agents: AgentType[] = ['claude', 'cursor-agent', 'opencode', 'gemini', 'codex']
        
        for (const agent of agents) {
            const vars: EnvVars = {}
            for (const item of envVars[agent]) {
                if (item.key.trim()) {
                    vars[item.key.trim()] = item.value
                }
            }
            await invoke('set_agent_env_vars', { agentType: agent, envVars: vars })
            await invoke('set_agent_cli_args', { agentType: agent, cliArgs: cliArgs[agent] })
        }
    }, [])
    
    const saveProjectSettings = useCallback(async (projectSettings: ProjectSettings): Promise<void> => {
        await invoke('set_project_settings', { settings: { setupScript: projectSettings.setupScript } })
        
        const projectEnvVarsObject = projectSettings.environmentVariables.reduce((acc, { key, value }) => {
            if (key) acc[key] = value
            return acc
        }, {} as Record<string, string>)
        
        await invoke('set_project_environment_variables', { envVars: projectEnvVarsObject })
    }, [])
    
    const saveTerminalSettings = useCallback(async (terminalSettings: TerminalSettings): Promise<void> => {
        await invoke('set_terminal_settings', { terminal: terminalSettings })
    }, [])
    
    const saveAllSettings = useCallback(async (
        envVars: Record<AgentType, Array<{key: string, value: string}>>,
        cliArgs: Record<AgentType, string>,
        projectSettings: ProjectSettings,
        terminalSettings: TerminalSettings
    ): Promise<SettingsSaveResult> => {
        setSaving(true)
        
        const savedSettings: string[] = []
        const failedSettings: string[] = []
        
        try {
            await saveAgentSettings(envVars, cliArgs)
            savedSettings.push('agent configurations')
        } catch (error) {
            console.error('Failed to save agent settings:', error)
            failedSettings.push('agent configurations')
        }
        
        try {
            await saveProjectSettings(projectSettings)
            savedSettings.push('project settings')
        } catch (error) {
            console.log('Project settings not saved - requires active project')
        }
        
        try {
            await saveTerminalSettings(terminalSettings)
            savedSettings.push('terminal settings')
        } catch (error) {
            console.log('Terminal settings not saved - requires active project')
        }
        
        setSaving(false)
        
        return {
            success: failedSettings.length === 0,
            savedSettings,
            failedSettings
        }
    }, [saveAgentSettings, saveProjectSettings, saveTerminalSettings])
    
    const loadEnvVars = useCallback(async (): Promise<Record<AgentType, Array<{key: string, value: string}>>> => {
        setLoading(true)
        try {
            const agents: AgentType[] = ['claude', 'cursor-agent', 'opencode', 'gemini', 'codex']
            const loadedVars: Record<AgentType, Array<{key: string, value: string}>> = {
                claude: [],
                'cursor-agent': [],
                opencode: [],
                gemini: [],
                codex: []
            }
            
            for (const agent of agents) {
                const vars = await invoke<EnvVars>('get_agent_env_vars', { agentType: agent })
                loadedVars[agent] = Object.entries(vars || {}).map(([key, value]) => ({ key, value }))
            }
            
            return loadedVars
        } finally {
            setLoading(false)
        }
    }, [])
    
    const loadCliArgs = useCallback(async (): Promise<Record<AgentType, string>> => {
        const agents: AgentType[] = ['claude', 'cursor-agent', 'opencode', 'gemini', 'codex']
        const loadedArgs: Record<AgentType, string> = {
            claude: '',
            'cursor-agent': '',
            opencode: '',
            gemini: '',
            codex: ''
        }
        
        for (const agent of agents) {
            const args = await invoke<string>('get_agent_cli_args', { agentType: agent })
            loadedArgs[agent] = args || ''
        }
        
        return loadedArgs
    }, [])
    
    const loadProjectSettings = useCallback(async (): Promise<ProjectSettings> => {
        try {
            const settings = await invoke<ProjectSettings>('get_project_settings')
            const envVars = await invoke<Record<string, string>>('get_project_environment_variables')
            const envVarArray = Object.entries(envVars || {}).map(([key, value]) => ({ key, value }))
            
            return {
                setupScript: settings?.setupScript || '',
                environmentVariables: envVarArray
            }
        } catch (error) {
            console.error('Failed to load project settings:', error)
            return { setupScript: '', environmentVariables: [] }
        }
    }, [])
    
    const loadTerminalSettings = useCallback(async (): Promise<TerminalSettings> => {
        try {
            const settings = await invoke<TerminalSettings>('get_terminal_settings')
            return {
                shell: settings?.shell || null,
                shellArgs: settings?.shellArgs || []
            }
        } catch (error) {
            console.error('Failed to load terminal settings:', error)
            return { shell: null, shellArgs: [] }
        }
    }, [])
    
    return {
        loading,
        saving,
        saveAllSettings,
        saveAgentSettings,
        saveProjectSettings,
        saveTerminalSettings,
        loadEnvVars,
        loadCliArgs,
        loadProjectSettings,
        loadTerminalSettings
    }
}