import { render, screen } from '@testing-library/react'
import { vi } from 'vitest'
import { SettingsModal } from './SettingsModal'
import { defaultShortcutConfig } from '../../keyboardShortcuts/config'
import { TauriCommands } from '../../common/tauriCommands'

const invokeMock = vi.fn(async (command: string) => {
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
    default:
      return null
  }
})

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => invokeMock(...(args as [string])),
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
  loadProjectSettings: vi.fn().mockResolvedValue({ setupScript: '', environmentVariables: [] }),
  loadTerminalSettings: vi.fn().mockResolvedValue({ shell: null, shellArgs: [], fontFamily: null }),
  loadSessionPreferences: vi.fn().mockResolvedValue({ auto_commit_on_review: false, skip_confirmation_modals: false }),
  loadKeyboardShortcuts: vi.fn().mockResolvedValue(defaultShortcutConfig),
  saveKeyboardShortcuts: vi.fn().mockResolvedValue(undefined),
  loadInstalledFonts: vi.fn().mockResolvedValue([]),
})

const useSettingsMock = vi.fn(createDefaultUseSettingsValue)

vi.mock('../../hooks/useSettings', () => ({
  useSettings: () => useSettingsMock(),
  AgentType: undefined,
}))

describe('SettingsModal loading indicators', () => {
  beforeEach(() => {
    useSettingsMock.mockReset()
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
