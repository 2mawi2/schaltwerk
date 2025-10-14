import { describe, it, expect, vi, beforeEach, MockedFunction } from 'vitest'
import { TauriCommands } from '../common/tauriCommands'
import { renderHook, act } from '@testing-library/react'
import { useSettings, AgentType } from './useSettings'
import { invoke, InvokeArgs } from '@tauri-apps/api/core'
import { KeyboardShortcutAction, KeyboardShortcutConfig, defaultShortcutConfig } from '../keyboardShortcuts/config'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('useSettings', () => {
  const mockInvoke = invoke as MockedFunction<typeof invoke>

  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('saveAgentSettings', () => {
    it('saves environment variables and CLI args for all agents', async () => {
      const { result } = renderHook(() => useSettings())
      
      const envVars: Record<AgentType, Array<{key: string, value: string}>> = {
        claude: [{ key: 'API_KEY', value: 'test-key' }],
        opencode: [{ key: 'OPENAI_API_KEY', value: 'openai-key' }],
        gemini: [{ key: 'PROJECT_ID', value: 'test-id' }],
        codex: [],
        droid: [{ key: 'WELCOME_PROMPT', value: 'ready' }],
        qwen: [{ key: 'PROJECT_ID', value: 'test-id' }]
      }

      const cliArgs: Record<AgentType, string> = {
        claude: '--verbose',
        opencode: '--temperature 0.8',
        gemini: '--project test',
        codex: '',
        droid: '--log-level debug',
        qwen: '--project test'
      }

      await act(async () => {
        await result.current.saveAgentSettings(envVars, cliArgs)
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentEnvVars, {
        agentType: 'claude',
        envVars: { API_KEY: 'test-key' }
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentCliArgs, {
        agentType: 'claude',
        cliArgs: '--verbose'
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentEnvVars, {
        agentType: 'opencode',
        envVars: { OPENAI_API_KEY: 'openai-key' }
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentCliArgs, {
        agentType: 'opencode',
        cliArgs: '--temperature 0.8'
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentEnvVars, {
        agentType: 'gemini',
        envVars: { PROJECT_ID: 'test-id' }
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentCliArgs, {
        agentType: 'gemini',
        cliArgs: '--project test'
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentEnvVars, {
        agentType: 'droid',
        envVars: { WELCOME_PROMPT: 'ready' }
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentCliArgs, {
        agentType: 'droid',
        cliArgs: '--log-level debug'
      })
      expect(mockInvoke).toHaveBeenCalledTimes(12)
    })

    it('filters out empty environment variable keys', async () => {
      const { result } = renderHook(() => useSettings())
      
      const envVars: Record<AgentType, Array<{key: string, value: string}>> = {
        claude: [
          { key: 'VALID_KEY', value: 'value' },
          { key: '', value: 'orphan-value' },
          { key: '  ', value: 'whitespace-key' }
        ],
        opencode: [],
        gemini: [],
        codex: [],
        droid: [],
        qwen: []
      }

      const cliArgs: Record<AgentType, string> = {
        claude: '',
        opencode: '',
        gemini: '',
        codex: '',
        droid: '',
        qwen: ''
      }

      await act(async () => {
        await result.current.saveAgentSettings(envVars, cliArgs)
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetAgentEnvVars, {
        agentType: 'claude',
        envVars: { VALID_KEY: 'value' }
      })
    })
  })

  describe('saveProjectSettings', () => {
    it('saves setup script and environment variables', async () => {
      const { result } = renderHook(() => useSettings())
      
      const projectSettings = {
        setupScript: 'bun install && bun run build',
        branchPrefix: 'feature',
        environmentVariables: [
          { key: 'NODE_ENV', value: 'production' },
          { key: 'PORT', value: '3000' }
        ]
      }

      await act(async () => {
        await result.current.saveProjectSettings(projectSettings)
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetProjectSettings, {
        settings: { setupScript: 'bun install && bun run build', branchPrefix: 'feature' }
      })
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetProjectEnvironmentVariables, {
        envVars: {
          NODE_ENV: 'production',
          PORT: '3000'
        }
      })
    })

    it('filters out empty keys from environment variables', async () => {
      const { result } = renderHook(() => useSettings())
      
      const projectSettings = {
        setupScript: '',
        branchPrefix: 'feature',
        environmentVariables: [
          { key: 'VALID', value: 'yes' },
          { key: '', value: 'no-key' }
        ]
      }

      await act(async () => {
        await result.current.saveProjectSettings(projectSettings)
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetProjectEnvironmentVariables, {
        envVars: { VALID: 'yes' }
      })
    })
  })

  describe('saveTerminalSettings', () => {
    it('saves terminal configuration', async () => {
      const { result } = renderHook(() => useSettings())
      
      const terminalSettings = {
        shell: '/bin/zsh',
        shellArgs: ['-l', '-c'],
        fontFamily: null,
      }

      await act(async () => {
        await result.current.saveTerminalSettings(terminalSettings)
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetTerminalSettings, {
        terminal: terminalSettings
      })
    })

    it('handles null shell', async () => {
      const { result } = renderHook(() => useSettings())
      
      const terminalSettings = {
        shell: null,
        shellArgs: [],
        fontFamily: null,
      }

      await act(async () => {
        await result.current.saveTerminalSettings(terminalSettings)
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetTerminalSettings, {
        terminal: terminalSettings
      })
    })
  })

  describe('loadInstalledFonts', () => {
    it('returns installed fonts from backend', async () => {
      const { result } = renderHook(() => useSettings())
      mockInvoke.mockResolvedValueOnce([
        { family: 'JetBrains Mono', monospace: true },
        { family: 'Arial', monospace: false },
      ])
      const fonts = await result.current.loadInstalledFonts()
      expect(fonts.length).toBe(2)
      expect(fonts[0].family).toBe('JetBrains Mono')
    })

    it('handles backend failure gracefully', async () => {
      const { result } = renderHook(() => useSettings())
      mockInvoke.mockRejectedValueOnce(new Error('boom'))
      const fonts = await result.current.loadInstalledFonts()
      expect(fonts).toEqual([])
    })
  })

  describe('saveAllSettings', () => {
    it('saves all settings and returns success result', async () => {
      const { result } = renderHook(() => useSettings())
      
      const envVars: Record<AgentType, Array<{key: string, value: string}>> = {
        claude: [],
        opencode: [],
        gemini: [],
        codex: [],
        droid: [],
        qwen: []
      }

      const cliArgs: Record<AgentType, string> = {
        claude: '',
        opencode: '',
        gemini: '',
        codex: '',
        droid: '',
        qwen: ''
      }
      
      const projectSettings = {
        setupScript: '',
        environmentVariables: [],
        branchPrefix: 'feature'
      }
      
      const terminalSettings = {
        shell: null,
        shellArgs: [],
        fontFamily: null,
      }

      const sessionPreferences = {
        auto_commit_on_review: false,
        skip_confirmation_modals: false
      }

      const mergePreferences = {
        autoCancelAfterMerge: true
      }

      const saveResult = await act(async () => {
        return await result.current.saveAllSettings(
          envVars,
          cliArgs,
          projectSettings,
          terminalSettings,
          sessionPreferences,
          mergePreferences
        )
      })

      expect(saveResult).toEqual({
        success: true,
        savedSettings: ['agent configurations', 'project settings', 'terminal settings', 'session preferences', 'merge preferences'],
        failedSettings: []
      })
      expect(result.current.saving).toBe(false)
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetProjectMergePreferences, {
        preferences: { auto_cancel_after_merge: true }
      })
    })

    it('handles partial failures gracefully', async () => {
      const { result } = renderHook(() => useSettings())
      
      mockInvoke.mockImplementation((command: string) => {
        if (command === TauriCommands.SetAgentEnvVars) {
          return Promise.reject(new Error('Agent settings failed'))
        }
        return Promise.resolve()
      })

      const envVars: Record<AgentType, Array<{key: string, value: string}>> = {
        claude: [],
        opencode: [],
        gemini: [],
        codex: [],
        droid: [],
        qwen: []
      }

      const cliArgs: Record<AgentType, string> = {
        claude: '',
        opencode: '',
        gemini: '',
        codex: '',
        droid: '',
        qwen: ''
      }
      
      const projectSettings = {
        setupScript: '',
        environmentVariables: [],
        branchPrefix: 'feature'
      }
      
      const terminalSettings = {
        shell: null,
        shellArgs: []
      }

      const sessionPreferences = {
        auto_commit_on_review: false,
        skip_confirmation_modals: false
      }

      const mergePreferences = {
        autoCancelAfterMerge: false
      }

      const saveResult = await act(async () => {
        return await result.current.saveAllSettings(
          envVars,
          cliArgs,
          projectSettings,
          terminalSettings,
          sessionPreferences,
          mergePreferences
        )
      })

      expect(saveResult).toEqual({
        success: false,
        savedSettings: ['project settings', 'terminal settings', 'session preferences', 'merge preferences'],
        failedSettings: ['agent configurations']
      })
    })

    it('ignores merge preferences errors when project context is unavailable', async () => {
      const { result } = renderHook(() => useSettings())

      mockInvoke.mockImplementation((command: string) => {
        if (command === TauriCommands.SetProjectMergePreferences) {
          return Promise.reject(new Error('Project manager not initialized'))
        }
        return Promise.resolve()
      })

      const envVars: Record<AgentType, Array<{key: string, value: string}>> = {
        claude: [],
        opencode: [],
        gemini: [],
        codex: [],
        droid: [],
        qwen: []
      }

      const cliArgs: Record<AgentType, string> = {
        claude: '',
        opencode: '',
        gemini: '',
        codex: '',
        droid: '',
        qwen: ''
      }

      const projectSettings = {
        setupScript: '',
        environmentVariables: [],
        branchPrefix: 'feature'
      }

      const terminalSettings = {
        shell: null,
        shellArgs: []
      }

      const sessionPreferences = {
        auto_commit_on_review: false,
        skip_confirmation_modals: false
      }

      const mergePreferences = {
        autoCancelAfterMerge: false
      }

      const saveResult = await act(async () => {
        return await result.current.saveAllSettings(
          envVars,
          cliArgs,
          projectSettings,
          terminalSettings,
          sessionPreferences,
          mergePreferences
        )
      })

      expect(saveResult).toEqual({
        success: true,
        savedSettings: ['agent configurations', 'project settings', 'terminal settings', 'session preferences'],
        failedSettings: []
      })
    })
  })

  describe('merge preferences', () => {
    it('loads merge preferences from backend', async () => {
      mockInvoke.mockImplementation(async (command: string) => {
        if (command === TauriCommands.GetProjectMergePreferences) {
          return { auto_cancel_after_merge: true }
        }
        return null
      })

      const { result } = renderHook(() => useSettings())

      const prefs = await act(async () => {
        return await result.current.loadMergePreferences()
      })

      expect(prefs).toEqual({ autoCancelAfterMerge: true })
    })

    it('defaults auto-cancel to true when backend omits preference', async () => {
      mockInvoke.mockImplementation(async (command: string) => {
        if (command === TauriCommands.GetProjectMergePreferences) {
          return {}
        }
        return null
      })

      const { result } = renderHook(() => useSettings())

      const prefs = await act(async () => {
        return await result.current.loadMergePreferences()
      })

      expect(prefs).toEqual({ autoCancelAfterMerge: true })
    })
  })

  describe('loadEnvVars', () => {
    it('loads environment variables for all agents', async () => {
      mockInvoke.mockImplementation((command: string, args?: InvokeArgs) => {
        if (command === TauriCommands.GetAgentEnvVars) {
          const agentType = (args as { agentType?: string })?.agentType
          if (agentType === 'claude') {
            return Promise.resolve({ API_KEY: 'claude-key' })
          }
          if (agentType === 'gemini') {
            return Promise.resolve({ PROJECT: 'gemini-project' })
          }
          return Promise.resolve({})
        }
        return Promise.resolve()
      })

      const { result } = renderHook(() => useSettings())
      
      const loadedVars = await act(async () => {
        return await result.current.loadEnvVars()
      })

      expect(loadedVars).toEqual({
        claude: [{ key: 'API_KEY', value: 'claude-key' }],
        opencode: [],
        gemini: [{ key: 'PROJECT', value: 'gemini-project' }],
        codex: [],
        droid: [],
        qwen: []
      })
      expect(result.current.loading).toBe(false)
    })

    it('handles null response from backend', async () => {
      mockInvoke.mockResolvedValue(null)

      const { result } = renderHook(() => useSettings())
      
      const loadedVars = await act(async () => {
        return await result.current.loadEnvVars()
      })

      expect(loadedVars).toEqual({
        claude: [],
        opencode: [],
        gemini: [],
        codex: [],
        droid: [],
        qwen: []
      })
    })
  })

  describe('loadCliArgs', () => {
    it('loads CLI arguments for all agents', async () => {
      mockInvoke.mockImplementation((command: string, args?: InvokeArgs) => {
        if (command === TauriCommands.GetAgentCliArgs) {
          const agentType = (args as { agentType?: string })?.agentType
          if (agentType === 'claude') {
            return Promise.resolve('--verbose --debug')
          }
          if (agentType === 'opencode') {
            return Promise.resolve('--silent')
          }
          return Promise.resolve('')
        }
        return Promise.resolve()
      })

      const { result } = renderHook(() => useSettings())
      
      const loadedArgs = await act(async () => {
        return await result.current.loadCliArgs()
      })

      expect(loadedArgs).toEqual({
        claude: '--verbose --debug',
        opencode: '--silent',
        gemini: '',
        codex: '',
        droid: '',
        qwen: ''
      })
    })

    it('handles null response as empty string', async () => {
      mockInvoke.mockResolvedValue(null)

      const { result } = renderHook(() => useSettings())
      
      const loadedArgs = await act(async () => {
        return await result.current.loadCliArgs()
      })

      expect(loadedArgs).toEqual({
        claude: '',
        opencode: '',
        gemini: '',
        codex: '',
        droid: '',
        qwen: ''
      })
    })
  })

  describe('loadProjectSettings', () => {
    it('loads project settings and environment variables', async () => {
      mockInvoke.mockImplementation((command: string) => {
        if (command === TauriCommands.GetProjectSettings) {
          return Promise.resolve({ setupScript: 'bun install', branchPrefix: 'team' })
        }
        if (command === 'get_project_environment_variables') {
          return Promise.resolve({ NODE_ENV: 'test', DEBUG: 'true' })
        }
        return Promise.resolve()
      })

      const { result } = renderHook(() => useSettings())
      
      const settings = await act(async () => {
        return await result.current.loadProjectSettings()
      })

      expect(settings).toEqual({
        setupScript: 'bun install',
        branchPrefix: 'team',
        environmentVariables: [
          { key: 'NODE_ENV', value: 'test' },
          { key: 'DEBUG', value: 'true' }
        ]
      })
    })

    it('returns defaults on error', async () => {
      mockInvoke.mockRejectedValue(new Error('Failed to load'))

      const { result } = renderHook(() => useSettings())
      
      const settings = await act(async () => {
        return await result.current.loadProjectSettings()
      })

      expect(settings).toEqual({
        setupScript: '',
        branchPrefix: 'schaltwerk',
        environmentVariables: []
      })
    })

    it('handles partial data gracefully', async () => {
      mockInvoke.mockImplementation((command: string) => {
        if (command === TauriCommands.GetProjectSettings) {
          return Promise.resolve(null)
        }
        if (command === 'get_project_environment_variables') {
          return Promise.resolve(null)
        }
        return Promise.resolve()
      })

      const { result } = renderHook(() => useSettings())
      
      const settings = await act(async () => {
        return await result.current.loadProjectSettings()
      })

      expect(settings).toEqual({
        setupScript: '',
        branchPrefix: 'schaltwerk',
        environmentVariables: []
      })
    })
  })

  describe('loadTerminalSettings', () => {
    it('loads terminal settings successfully', async () => {
      mockInvoke.mockResolvedValue({
        shell: '/bin/bash',
        shellArgs: ['-l'],
        fontFamily: null,
      })

      const { result } = renderHook(() => useSettings())
      
      const settings = await act(async () => {
        return await result.current.loadTerminalSettings()
      })

      expect(settings).toEqual({
        shell: '/bin/bash',
        shellArgs: ['-l'],
        fontFamily: null,
        webglEnabled: true,
      })
    })

    it('returns defaults on error', async () => {
      mockInvoke.mockRejectedValue(new Error('Failed'))

      const { result } = renderHook(() => useSettings())
      
      const settings = await act(async () => {
        return await result.current.loadTerminalSettings()
      })

      expect(settings).toEqual({
        shell: null,
        shellArgs: [],
        fontFamily: null,
        webglEnabled: true,
      })
    })

    it('handles null response', async () => {
      mockInvoke.mockResolvedValue(null)

      const { result } = renderHook(() => useSettings())
      
      const settings = await act(async () => {
        return await result.current.loadTerminalSettings()
      })

      expect(settings).toEqual({
        shell: null,
        shellArgs: [],
        fontFamily: null,
        webglEnabled: true,
      })
    })
  })

  describe('keyboard shortcut settings', () => {
    it('saves keyboard shortcut config via tauri command', async () => {
      const { result } = renderHook(() => useSettings())

      const shortcuts: KeyboardShortcutConfig = {
        ...defaultShortcutConfig,
        [KeyboardShortcutAction.CancelSession]: ['Mod+X'],
      }

      await act(async () => {
        await result.current.saveKeyboardShortcuts(shortcuts)
      })

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.SetKeyboardShortcuts, {
        shortcuts,
      })
    })

    it('loads keyboard shortcuts and falls back to defaults when backend returns null', async () => {
      const { result } = renderHook(() => useSettings())

      mockInvoke.mockResolvedValueOnce(null)

      const shortcuts = await result.current.loadKeyboardShortcuts()

      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetKeyboardShortcuts)
      expect(shortcuts[KeyboardShortcutAction.CancelSession]).toEqual(['Mod+D'])
    })
  })
})
