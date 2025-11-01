import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { defaultShortcutConfig } from '../../keyboardShortcuts/config'
import { TauriCommands } from '../../common/tauriCommands'

const baseInvokeImplementation = async (command: string, _args?: unknown) => {
  switch (command) {
    case TauriCommands.GetAllAgentBinaryConfigs:
      return []
    case TauriCommands.GetProjectRunScript:
      return null
    case TauriCommands.GetActiveProjectPath:
      return null
    case TauriCommands.GetProjectActionButtons:
      return []
    case TauriCommands.GetAgentBinaryConfig:
    case TauriCommands.RefreshAgentBinaryDetection:
      return {
        agent_name: 'claude',
        custom_path: null,
        auto_detect: true,
        detected_binaries: [],
      }
    case TauriCommands.GetAppVersion:
      return '0.2.2'
    case TauriCommands.GetAutoUpdateEnabled:
      return true
    case TauriCommands.SetAutoUpdateEnabled:
      return null
    case TauriCommands.GetDevErrorToastsEnabled:
      return false
    case TauriCommands.SetDevErrorToastsEnabled:
      return null
    case TauriCommands.CheckForUpdatesNow:
      return {
        status: 'upToDate',
        initiatedBy: 'manual',
        currentVersion: '0.2.2',
        newVersion: null,
        notes: null,
        errorKind: null,
        errorMessage: null,
      }
    default:
      return null
  }
}

const invokeMock = vi.fn<(command: string, args?: unknown) => Promise<unknown>>(baseInvokeImplementation)

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string, unknown])),
}))

vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(),
}))

vi.mock('../SpecContentModal', () => ({
  SpecContentModal: () => null,
}))

vi.mock('../settings/MCPConfigPanel', () => ({
  MCPConfigPanel: () => null,
}))

vi.mock('../settings/GithubProjectIntegrationCard', () => ({
  GithubProjectIntegrationCard: () => null,
}))

vi.mock('../settings/SettingsArchivesSection', () => ({
  SettingsArchivesSection: () => null,
}))

const requestDockBounceMock = vi.fn()

vi.mock('../../utils/attentionBridge', () => ({
  requestDockBounce: requestDockBounceMock,
}))

vi.mock('./FontPicker', () => ({
  FontPicker: () => null,
}))

const useFontSizeValue = {
  terminalFontSize: 13,
  uiFontSize: 12,
  setTerminalFontSize: vi.fn(),
  setUiFontSize: vi.fn(),
  increaseFontSizes: vi.fn(),
  decreaseFontSizes: vi.fn(),
  resetFontSizes: vi.fn(),
}

vi.mock('../../contexts/FontSizeContext', () => ({
  useFontSize: () => useFontSizeValue,
}))

const applyOverridesMock = vi.fn()

vi.mock('../../contexts/KeyboardShortcutsContext', () => ({
  useKeyboardShortcutsConfig: () => ({
    config: defaultShortcutConfig,
    loading: false,
    setConfig: vi.fn(),
    applyOverrides: applyOverridesMock,
    resetToDefaults: vi.fn(),
    refresh: vi.fn(),
  }),
}))

const actionButtonsValue = {
  actionButtons: [],
  loading: false,
  error: null,
  saveActionButtons: vi.fn().mockResolvedValue(true),
  resetToDefaults: vi.fn().mockResolvedValue(true),
  reloadActionButtons: vi.fn().mockResolvedValue(undefined),
}

vi.mock('../../hooks/useActionButtons', () => ({
  useActionButtons: () => actionButtonsValue,
}))

const createEmptyEnvVars = () => ({
  claude: [],
  opencode: [],
  gemini: [],
  codex: [],
})

const createEmptyCliArgs = () => ({
  claude: '',
  opencode: '',
  gemini: '',
  codex: '',
})

const createEmptyPreferences = () => ({
  claude: { model: '', reasoningEffort: '' },
  opencode: { model: '', reasoningEffort: '' },
  gemini: { model: '', reasoningEffort: '' },
  codex: { model: '', reasoningEffort: '' },
  droid: { model: '', reasoningEffort: '' },
  qwen: { model: '', reasoningEffort: '' },
  amp: { model: '', reasoningEffort: '' },
  terminal: { model: '', reasoningEffort: '' },
})

const createDefaultUseSettingsValue = () => ({
  loading: false,
  saving: false,
  saveAllSettings: vi.fn().mockResolvedValue({ success: true, savedSettings: [], failedSettings: [] }),
  loadEnvVars: vi.fn().mockResolvedValue(createEmptyEnvVars()),
  loadCliArgs: vi.fn().mockResolvedValue(createEmptyCliArgs()),
  loadAgentPreferences: vi.fn().mockResolvedValue(createEmptyPreferences()),
  loadProjectSettings: vi.fn().mockResolvedValue({ setupScript: '', branchPrefix: 'schaltwerk', environmentVariables: [] }),
  loadTerminalSettings: vi.fn().mockResolvedValue({ shell: null, shellArgs: [], fontFamily: null }),
  loadSessionPreferences: vi.fn().mockResolvedValue({
    auto_commit_on_review: false,
    skip_confirmation_modals: false,
    always_show_large_diffs: false,
    attention_notification_mode: 'dock',
    remember_idle_baseline: true
  }),
  loadMergePreferences: vi.fn().mockResolvedValue({ autoCancelAfterMerge: true }),
  loadKeyboardShortcuts: vi.fn().mockResolvedValue(defaultShortcutConfig),
  saveKeyboardShortcuts: vi.fn().mockResolvedValue(undefined),
  loadInstalledFonts: vi.fn().mockResolvedValue([]),
})

const useSettingsMock = vi.fn(createDefaultUseSettingsValue)

const createDefaultUseSessionsValue = () => ({
  autoCancelAfterMerge: true,
  updateAutoCancelAfterMerge: vi.fn().mockResolvedValue(undefined),
})

const useSessionsMock = vi.fn(createDefaultUseSessionsValue)

vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => useSettingsMock(),
  AgentType: undefined,
}))

vi.mock('../../hooks/useSessions', () => ({
  useSessions: () => useSessionsMock(),
}))

describe('SettingsModal loading indicators', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
  })

  it('renders textual loader when settings are loading', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loading = true
    useSettingsMock.mockReturnValue(settingsValue)

    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    expect(await screen.findByText('Loading settings...')).toBeInTheDocument()
  })

  it('shows saving text in footer button when saving', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.saving = true
    useSettingsMock.mockReturnValue(settingsValue)

    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    expect(await screen.findByRole('button', { name: 'Saving...' })).toBeInTheDocument()
  })

  it('triggers attention notification test button', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loadSessionPreferences = vi.fn().mockResolvedValue({
      auto_commit_on_review: false,
      skip_confirmation_modals: false,
      always_show_large_diffs: false,
      attention_notification_mode: 'dock',
      remember_idle_baseline: true
    })
    useSettingsMock.mockReturnValue(settingsValue)

    const user = userEvent.setup()

    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Sessions' }))

    const testButton = await screen.findByText('Test notification')
    await user.click(testButton)

    await waitFor(() => expect(requestDockBounceMock).toHaveBeenCalled())
  })

  it('disables remember idle baseline toggle when notifications are off', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    settingsValue.loadSessionPreferences = vi.fn().mockResolvedValue({
      auto_commit_on_review: false,
      skip_confirmation_modals: false,
      always_show_large_diffs: false,
      attention_notification_mode: 'off',
      remember_idle_baseline: true
    })
    useSettingsMock.mockReturnValue(settingsValue)

    const user = userEvent.setup()

    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await user.click(await screen.findByRole('button', { name: 'Sessions' }))

    const baselineToggle = await screen.findByLabelText('Remember idle sessions when I switch away')
    expect(baselineToggle).toBeDisabled()
  })
})

describe('SettingsModal initial tab handling', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSessionsMock.mockReset()
    invokeMock.mockClear()
    invokeMock.mockImplementation(async (command: string, args?: unknown) => {
      if (command === TauriCommands.GetActiveProjectPath) {
        return '/Users/test/project'
      }
      return baseInvokeImplementation(command, args)
    })
    requestDockBounceMock.mockReset()
  })

  it('opens the specified initial tab when provided', async () => {
    render(
      <SettingsModal
        open={true}
        initialTab="projectRun"
        onClose={() => {}}
      />
    )

    const runButton = await screen.findByRole('button', { name: 'Run & Environment' })
    await waitFor(() => {
      expect(runButton).toHaveClass('bg-slate-800')
      expect(runButton).toHaveClass('text-slate-200')
    })
  })

  it('defaults to the project settings tab when no initial tab is provided', async () => {
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    const projectSettingsButton = await screen.findByRole('button', { name: 'Project Settings' })
    await waitFor(() => {
      expect(projectSettingsButton).toHaveClass('bg-slate-800')
      expect(projectSettingsButton).toHaveClass('text-slate-200')
    })
  })

  it('responds to changes in the initialTab prop', async () => {
    const { rerender } = render(
      <SettingsModal
        open={true}
        initialTab="appearance"
        onClose={() => {}}
      />
    )

    const appearanceButton = await screen.findByRole('button', { name: 'Appearance' })
    await waitFor(() => {
      expect(appearanceButton).toHaveClass('bg-slate-800')
    })

    rerender(
      <SettingsModal
        open={true}
        initialTab="projectRun"
        onClose={() => {}}
      />
    )

    const runButton = await screen.findByRole('button', { name: 'Run & Environment' })
    await waitFor(() => {
      expect(runButton).toHaveClass('bg-slate-800')
      expect(appearanceButton).not.toHaveClass('bg-slate-800')
    })
  })

}) 

describe('SettingsModal version settings', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
  })

  it('loads auto update preference on mount', async () => {
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetAutoUpdateEnabled)
    })
  })

  it('allows toggling automatic updates from the version tab', async () => {
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Version' }))
    const toggle = await screen.findByRole('checkbox', { name: /Automatically install updates/i })
    await userEvent.click(toggle)

    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.SetAutoUpdateEnabled, { enabled: false })
  })

  it('invokes manual update check command', async () => {
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await userEvent.click(await screen.findByRole('button', { name: 'Version' }))
    const checkButton = await screen.findByRole('button', { name: /Check for updates/i })
    await userEvent.click(checkButton)

    expect(invokeMock).toHaveBeenCalledWith(TauriCommands.CheckForUpdatesNow)
  })
})

describe('SettingsModal appearance settings', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
  })

  it('loads dev error toast preference on mount', async () => {
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetDevErrorToastsEnabled)
    })
  })

  it('persists dev error toast preference changes', async () => {
    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await waitFor(() => {
      expect(invokeMock).toHaveBeenCalledWith(TauriCommands.GetDevErrorToastsEnabled)
    })

    await screen.findByRole('checkbox', { name: /Show error toasts automatically during dev runs/i })
    await userEvent.click(screen.getByRole('checkbox', { name: /Show error toasts automatically during dev runs/i }))

    await userEvent.click(await screen.findByRole('button', { name: 'Save' }))

    await waitFor(() => {
      const didInvoke = invokeMock.mock.calls.some(([command, args]) => {
        if (command !== TauriCommands.SetDevErrorToastsEnabled) return false
        const payload = args as { enabled?: boolean } | undefined
        return payload?.enabled === true
      })
      expect(didInvoke).toBe(true)
    })
  })
})

describe('SettingsModal project settings navigation', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSettingsMock.mockReturnValue(createDefaultUseSettingsValue())
    useSessionsMock.mockReset()
    useSessionsMock.mockReturnValue(createDefaultUseSessionsValue())
    invokeMock.mockClear()
    invokeMock.mockImplementation(baseInvokeImplementation)
    requestDockBounceMock.mockReset()
  })

  it('nests run script and action buttons under Project Settings sub-navigation', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    useSettingsMock.mockReturnValue(settingsValue)

    invokeMock.mockImplementation((command: string, args?: unknown) => {
      if (command === TauriCommands.GetActiveProjectPath) {
        return Promise.resolve('/Users/example/project')
      }
      return baseInvokeImplementation(command, args)
    })

    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    const user = userEvent.setup()

    const projectNavButton = await screen.findByRole('button', { name: 'Project Settings' })
    await user.click(projectNavButton)
    expect(await screen.findByText('Branch Prefix')).toBeInTheDocument()

    const actionNavButton = await screen.findByRole('button', { name: 'Action Buttons' })
    await user.click(actionNavButton)
    expect(await screen.findByRole('button', { name: 'Reset to Defaults' })).toBeInTheDocument()

    const runNavButton = await screen.findByRole('button', { name: 'Run & Environment' })
    await user.click(runNavButton)

    expect(await screen.findByText('Run Script')).toBeInTheDocument()

    invokeMock.mockImplementation(baseInvokeImplementation)
  })

  it('hides project settings navigation when no project is active', async () => {
    const settingsValue = createDefaultUseSettingsValue()
    useSettingsMock.mockReturnValue(settingsValue)

    render(
      <SettingsModal
        open={true}
        onClose={() => {}}
      />
    )

    await screen.findByRole('button', { name: 'Appearance' })
    expect(screen.queryByRole('button', { name: 'Project Settings' })).not.toBeInTheDocument()
    expect(screen.queryByText('Project')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archives' })).not.toBeInTheDocument()
  })
})
