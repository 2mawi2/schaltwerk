import { useState, useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'
import { emitUiEvent, UiEvent } from '../common/uiEvents'
import {
    KeyboardShortcutConfig,
    defaultShortcutConfig,
    mergeShortcutConfig,
    normalizeShortcutConfig,
    PartialKeyboardShortcutConfig,
} from '../keyboardShortcuts/config'
import { AgentType, AGENT_TYPES, createAgentRecord } from '../types/session'

export type { AgentType }
type EnvVars = Record<string, string>

interface ProjectSettings {
    setupScript: string
    branchPrefix: string
    environmentVariables: Array<{key: string, value: string}>
}

const DEFAULT_BRANCH_PREFIX = 'schaltwerk'

const extractErrorMessage = (error: unknown): string => {
    if (error instanceof Error && error.message) return error.message
    if (typeof error === 'string') return error
    if (error && typeof error === 'object' && 'message' in error) {
        const maybeMessage = (error as { message?: unknown }).message
        if (typeof maybeMessage === 'string') return maybeMessage
    }
    return ''
}

const isProjectUnavailableError = (error: unknown): boolean => {
    const message = extractErrorMessage(error)
    return message.includes('Project manager not initialized') || message.includes('Failed to get current project')
}

const isCommandUnavailableError = (error: unknown, command: string): boolean => {
    const message = extractErrorMessage(error)
    if (!message) return false
    const patterns = [
        `Command "${command}"`,
        `command "${command}" not found`,
        'command not found',
    ]
    return patterns.some(pattern => message.includes(pattern))
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

export interface ProjectMergePreferences {
    autoCancelAfterMerge: boolean
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
        const agents: AgentType[] = [...AGENT_TYPES]
        
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
        const trimmed = projectSettings.branchPrefix.trim()
        const withoutWhitespace = trimmed.replace(/\s+/g, '-')
        const normalized = withoutWhitespace.replace(/^\/+|\/+$/g, '')
        const branchPrefix = normalized || DEFAULT_BRANCH_PREFIX

        await invoke(TauriCommands.SetProjectSettings, { settings: { setupScript: projectSettings.setupScript, branchPrefix } })
        
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
                emitUiEvent(UiEvent.TerminalFontUpdated, { fontFamily: font })
            }
        } catch (e) {
            logger.warn('Failed to dispatch terminal font update event', e)
        }
    }, [])
    
    const saveSessionPreferences = useCallback(async (sessionPreferences: SessionPreferences): Promise<void> => {
        await invoke(TauriCommands.SetSessionPreferences, { preferences: sessionPreferences })
    }, [])

    const saveMergePreferences = useCallback(async (mergePreferences: ProjectMergePreferences): Promise<void> => {
        await invoke(TauriCommands.SetProjectMergePreferences, {
            preferences: {
                auto_cancel_after_merge: mergePreferences.autoCancelAfterMerge
            }
        })
    }, [])

    const saveAllSettings = useCallback(async (
        envVars: Record<AgentType, Array<{key: string, value: string}>>,
        cliArgs: Record<AgentType, string>,
        projectSettings: ProjectSettings,
        terminalSettings: TerminalSettings,
        sessionPreferences: SessionPreferences,
        mergePreferences: ProjectMergePreferences
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

        try {
            await saveMergePreferences(mergePreferences)
            savedSettings.push('merge preferences')
        } catch (error) {
            if (isProjectUnavailableError(error)) {
                logger.info('Merge preferences not saved - requires active project', error)
            } else if (isCommandUnavailableError(error, TauriCommands.SetProjectMergePreferences)) {
                logger.info('Merge preferences command unavailable - skipping save', error)
            } else {
                logger.error('Failed to save project merge preferences:', error)
                failedSettings.push('merge preferences')
            }
        }

        setSaving(false)

        return {
            success: failedSettings.length === 0,
            savedSettings,
            failedSettings
        }
    }, [saveAgentSettings, saveProjectSettings, saveTerminalSettings, saveSessionPreferences, saveMergePreferences])
    
    const loadEnvVars = useCallback(async (): Promise<Record<AgentType, Array<{key: string, value: string}>>> => {
        setLoading(true)
        try {
            const loadedVars: Record<AgentType, Array<{key: string, value: string}>> =
                createAgentRecord(_agent => [])

            for (const agent of AGENT_TYPES) {
                const vars = await invoke<EnvVars>(TauriCommands.GetAgentEnvVars, { agentType: agent })
                loadedVars[agent] = Object.entries(vars || {}).map(([key, value]) => ({ key, value }))
            }

            return loadedVars
        } finally {
            setLoading(false)
        }
    }, [])
    
    const loadCliArgs = useCallback(async (): Promise<Record<AgentType, string>> => {
        const loadedArgs: Record<AgentType, string> = createAgentRecord(_agent => '')

        for (const agent of AGENT_TYPES) {
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
                branchPrefix: settings?.branchPrefix || DEFAULT_BRANCH_PREFIX,
                environmentVariables: envVarArray
            }
        } catch (error) {
            logger.error('Failed to load project settings:', error)
            return { setupScript: '', branchPrefix: DEFAULT_BRANCH_PREFIX, environmentVariables: [] }
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

    const loadMergePreferences = useCallback(async (): Promise<ProjectMergePreferences> => {
        try {
            const preferences = await invoke<{ auto_cancel_after_merge: boolean }>(
                TauriCommands.GetProjectMergePreferences
            )
            return {
                autoCancelAfterMerge: preferences?.auto_cancel_after_merge !== false
            }
        } catch (error) {
            logger.error('Failed to load project merge preferences:', error)
            return { autoCancelAfterMerge: true }
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
        loadMergePreferences,
        loadKeyboardShortcuts,
        loadInstalledFonts,
    }
}
