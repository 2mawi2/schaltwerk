import { useState, useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'
import {
    KeyboardShortcutConfig,
    defaultShortcutConfig,
    mergeShortcutConfig,
    normalizeShortcutConfig,
    PartialKeyboardShortcutConfig,
} from '../keyboardShortcuts/config'

export type AgentType = 'claude' | 'opencode' | 'gemini' | 'codex'
type EnvVars = Record<string, string>

interface ProjectSettings {
    setupScript: string
    environmentVariables: Array<{key: string, value: string}>
}

interface TerminalSettings {
    shell: string | null
    shellArgs: string[]
    fontFamily?: string | null
}

interface SessionPreferences {
    auto_commit_on_review: boolean
    skip_confirmation_modals: boolean
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
        const agents: AgentType[] = ['claude', 'opencode', 'gemini', 'codex']
        
        for (const agent of agents) {
            const vars: EnvVars = {}
            for (const item of envVars[agent]) {
                if (item.key.trim()) {
                    vars[item.key.trim()] = item.value
                }
            }
            await invoke(TauriCommands.SetAgentEnvVars, { agentType: agent, envVars: vars })
            await invoke(TauriCommands.SetAgentCliArgs, { agentType: agent, cliArgs: cliArgs[agent] })
        }
    }, [])
    
    const saveProjectSettings = useCallback(async (projectSettings: ProjectSettings): Promise<void> => {
        await invoke(TauriCommands.SetProjectSettings, { settings: { setupScript: projectSettings.setupScript } })
        
        const projectEnvVarsObject = projectSettings.environmentVariables.reduce((acc, { key, value }) => {
            if (key) acc[key] = value
            return acc
        }, {} as Record<string, string>)
        
        await invoke(TauriCommands.SetProjectEnvironmentVariables, { envVars: projectEnvVarsObject })
    }, [])
    
    const saveTerminalSettings = useCallback(async (terminalSettings: TerminalSettings): Promise<void> => {
        await invoke(TauriCommands.SetTerminalSettings, { terminal: terminalSettings })
        try {
            if (typeof window !== 'undefined') {
                const font = terminalSettings.fontFamily || null
                window.dispatchEvent(new CustomEvent('schaltwerk:terminal-font-updated', { detail: { fontFamily: font } }))
            }
        } catch (e) {
            logger.warn('Failed to dispatch terminal font update event', e)
        }
    }, [])
    
    const saveSessionPreferences = useCallback(async (sessionPreferences: SessionPreferences): Promise<void> => {
        await invoke(TauriCommands.SetSessionPreferences, { preferences: sessionPreferences })
    }, [])
    
    const saveAllSettings = useCallback(async (
        envVars: Record<AgentType, Array<{key: string, value: string}>>,
        cliArgs: Record<AgentType, string>,
        projectSettings: ProjectSettings,
        terminalSettings: TerminalSettings,
        sessionPreferences: SessionPreferences
    ): Promise<SettingsSaveResult> => {
        setSaving(true)
        
        const savedSettings: string[] = []
        const failedSettings: string[] = []
        
        try {
            await saveAgentSettings(envVars, cliArgs)
            savedSettings.push('agent configurations')
        } catch (error) {
            logger.error('Failed to save agent settings:', error)
            failedSettings.push('agent configurations')
        }
        
        try {
            await saveProjectSettings(projectSettings)
            savedSettings.push('project settings')
        } catch (error) {
            logger.info('Project settings not saved - requires active project', error)
        }
        
        try {
            await saveTerminalSettings(terminalSettings)
            savedSettings.push('terminal settings')
        } catch (error) {
            logger.info('Terminal settings not saved - requires active project', error)
        }
        
        try {
            await saveSessionPreferences(sessionPreferences)
            savedSettings.push('session preferences')
        } catch (error) {
            logger.error('Failed to save session preferences:', error)
            failedSettings.push('session preferences')
        }
        
        setSaving(false)
        
        return {
            success: failedSettings.length === 0,
            savedSettings,
            failedSettings
        }
    }, [saveAgentSettings, saveProjectSettings, saveTerminalSettings, saveSessionPreferences])
    
    const loadEnvVars = useCallback(async (): Promise<Record<AgentType, Array<{key: string, value: string}>>> => {
        setLoading(true)
        try {
            const agents: AgentType[] = ['claude', 'opencode', 'gemini', 'codex']
            const loadedVars: Record<AgentType, Array<{key: string, value: string}>> = {
                claude: [],
                opencode: [],
                gemini: [],
                codex: []
            }
            
            for (const agent of agents) {
                const vars = await invoke<EnvVars>(TauriCommands.GetAgentEnvVars, { agentType: agent })
                loadedVars[agent] = Object.entries(vars || {}).map(([key, value]) => ({ key, value }))
            }
            
            return loadedVars
        } finally {
            setLoading(false)
        }
    }, [])
    
    const loadCliArgs = useCallback(async (): Promise<Record<AgentType, string>> => {
        const agents: AgentType[] = ['claude', 'opencode', 'gemini', 'codex']
        const loadedArgs: Record<AgentType, string> = {
            claude: '',
            opencode: '',
            gemini: '',
            codex: ''
        }
        
        for (const agent of agents) {
            const args = await invoke<string>(TauriCommands.GetAgentCliArgs, { agentType: agent })
            loadedArgs[agent] = args || ''
        }
        
        return loadedArgs
    }, [])
    
    const loadProjectSettings = useCallback(async (): Promise<ProjectSettings> => {
        try {
            const settings = await invoke<ProjectSettings>(TauriCommands.GetProjectSettings)
            const envVars = await invoke<Record<string, string>>('get_project_environment_variables')
            const envVarArray = Object.entries(envVars || {}).map(([key, value]) => ({ key, value }))
            
            return {
                setupScript: settings?.setupScript || '',
                environmentVariables: envVarArray
            }
        } catch (error) {
            logger.error('Failed to load project settings:', error)
            return { setupScript: '', environmentVariables: [] }
        }
    }, [])
    
    const loadTerminalSettings = useCallback(async (): Promise<TerminalSettings> => {
        try {
            const settings = await invoke<TerminalSettings>(TauriCommands.GetTerminalSettings)
            return {
                shell: settings?.shell || null,
                shellArgs: settings?.shellArgs || [],
                fontFamily: settings?.fontFamily ?? null
            }
        } catch (error) {
            logger.error('Failed to load terminal settings:', error)
            return { shell: null, shellArgs: [], fontFamily: null }
        }
    }, [])
    
    const loadSessionPreferences = useCallback(async (): Promise<SessionPreferences> => {
        try {
            const preferences = await invoke<SessionPreferences>(TauriCommands.GetSessionPreferences)
            return preferences || { auto_commit_on_review: false, skip_confirmation_modals: false }
        } catch (error) {
            logger.error('Failed to load session preferences:', error)
            return { auto_commit_on_review: false, skip_confirmation_modals: false }
        }
    }, [])
    
    const loadInstalledFonts = useCallback(async (): Promise<Array<{ family: string, monospace: boolean }>> => {
        try {
            const items = await invoke<Array<{ family: string, monospace: boolean }>>('list_installed_fonts')
            return Array.isArray(items) ? items : []
        } catch (error) {
            logger.error('Failed to list installed fonts:', error)
            return []
        }
    }, [])

    const saveKeyboardShortcuts = useCallback(async (shortcuts: KeyboardShortcutConfig): Promise<void> => {
        const normalized = normalizeShortcutConfig(shortcuts)
        await invoke(TauriCommands.SetKeyboardShortcuts, { shortcuts: normalized })
    }, [])

    const loadKeyboardShortcuts = useCallback(async (): Promise<KeyboardShortcutConfig> => {
        try {
            const stored = await invoke<PartialKeyboardShortcutConfig | null>(TauriCommands.GetKeyboardShortcuts)
            return mergeShortcutConfig(stored ?? undefined)
        } catch (error) {
            logger.error('Failed to load keyboard shortcuts:', error)
            return defaultShortcutConfig
        }
    }, [])

    return {
        loading,
        saving,
        saveAllSettings,
        saveAgentSettings,
        saveProjectSettings,
        saveTerminalSettings,
        saveSessionPreferences,
        saveKeyboardShortcuts,
        loadEnvVars,
        loadCliArgs,
        loadProjectSettings,
        loadTerminalSettings,
        loadSessionPreferences,
        loadKeyboardShortcuts,
        loadInstalledFonts,
    }
}
