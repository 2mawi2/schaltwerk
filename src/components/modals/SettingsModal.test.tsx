import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { vi } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { defaultShortcutConfig } from '../../keyboardShortcuts/config'
import { TauriCommands } from '../../common/tauriCommands'

const invokeMock = vi.fn(async (command: string, _args?: unknown) => {
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
})

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

vi.mock('../settings/SettingsArchivesSection', () => ({
  SettingsArchivesSection: () => null,
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

vi.mock('../../contexts/ActionButtonsContext', () => ({
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

const createDefaultUseSettingsValue = () => ({
  loading: false,
  saving: false,
  saveAllSettings: vi.fn().mockResolvedValue({ success: true, savedSettings: [], failedSettings: [] }),
  loadEnvVars: vi.fn().mockResolvedValue(createEmptyEnvVars()),
  loadCliArgs: vi.fn().mockResolvedValue(createEmptyCliArgs()),
  loadProjectSettings: vi.fn().mockResolvedValue({ setupScript: '', branchPrefix: 'schaltwerk', environmentVariables: [] }),
  loadTerminalSettings: vi.fn().mockResolvedValue({ shell: null, shellArgs: [], fontFamily: null }),
  loadSessionPreferences: vi.fn().mockResolvedValue({ auto_commit_on_review: false, skip_confirmation_modals: false }),
  loadMergePreferences: vi.fn().mockResolvedValue({ autoCancelAfterMerge: false }),
  loadKeyboardShortcuts: vi.fn().mockResolvedValue(defaultShortcutConfig),
  saveKeyboardShortcuts: vi.fn().mockResolvedValue(undefined),
  loadInstalledFonts: vi.fn().mockResolvedValue([]),
})

const useSettingsMock = vi.fn(createDefaultUseSettingsValue)

const createDefaultUseSessionsValue = () => ({
  autoCancelAfterMerge: false,
  updateAutoCancelAfterMerge: vi.fn().mockResolvedValue(undefined),
})

const useSessionsMock = vi.fn(createDefaultUseSessionsValue)

vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => useSettingsMock(),
  AgentType: undefined,
}))

vi.mock('../../contexts/SessionsContext', () => ({
  useSessions: () => useSessionsMock(),
}))

describe('SettingsModal loading indicators', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSessionsMock.mockReset()
    invokeMock.mockClear()
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
})

describe('SettingsModal version settings', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
    useSessionsMock.mockReset()
    invokeMock.mockClear()
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
