import { useState, useEffect, useCallback, useMemo, ReactElement } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useFontSize } from '../../contexts/FontSizeContext'
import { useSettings, AgentType } from '../../hooks/useSettings'
import { useActionButtons } from '../../contexts/ActionButtonsContext'
import type { HeaderActionConfig } from '../ActionButton'
// macOS-native smart dash/quote substitution is disabled at app startup.
import { SpecContentModal } from '../SpecContentModal'
import { MCPConfigPanel } from '../settings/MCPConfigPanel'
import { SettingsArchivesSection } from '../settings/SettingsArchivesSection'
import { logger } from '../../utils/logger'
import { FontPicker } from './FontPicker'
import {
    KeyboardShortcutAction,
    KeyboardShortcutConfig,
    defaultShortcutConfig,
    mergeShortcutConfig,
} from '../../keyboardShortcuts/config'
import { KEYBOARD_SHORTCUT_SECTIONS } from '../../keyboardShortcuts/metadata'
import { shortcutFromEvent, normalizeShortcut } from '../../keyboardShortcuts/matcher'
import { detectPlatformSafe, getDisplayLabelForSegment, splitShortcutBinding } from '../../keyboardShortcuts/helpers'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { theme } from '../../common/theme'

const shortcutArraysEqual = (a: string[] = [], b: string[] = []) => {
    if (a.length !== b.length) return false
    return a.every((value, index) => value === b[index])
}

const shortcutConfigsEqual = (a: KeyboardShortcutConfig, b: KeyboardShortcutConfig) => {
    return Object.values(KeyboardShortcutAction).every(action =>
        shortcutArraysEqual(a[action], b[action])
    )
}

interface Props {
    open: boolean
    onClose: () => void
    onOpenTutorial?: () => void
}

type NotificationType = 'success' | 'error' | 'info'

interface NotificationState {
    message: string
    type: NotificationType
    visible: boolean
}

type SettingsCategory = 'appearance' | 'keyboard' | 'environment' | 'projects' | 'terminal' | 'sessions' | 'archives' | 'actions' | 'version'

interface DetectedBinary {
    path: string
    version?: string
    installation_method: 'Homebrew' | 'Npm' | 'Pip' | 'Manual' | 'System'
    is_recommended: boolean
    is_symlink: boolean
    symlink_target?: string
}

interface AgentBinaryConfig {
    agent_name: string
    custom_path: string | null
    auto_detect: boolean
    detected_binaries: DetectedBinary[]
}

interface CategoryConfig {
    id: SettingsCategory
    label: string
    icon: ReactElement
}

const CATEGORIES: CategoryConfig[] = [
    {
        id: 'appearance',
        label: 'Appearance',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 21a4 4 0 01-4-4V5a2 2 0 012-2h4a2 2 0 012 2v12a4 4 0 01-4 4zm0 0h12a2 2 0 002-2v-4a2 2 0 00-2-2h-2.343M11 7.343l1.657-1.657a2 2 0 012.828 0l2.829 2.829a2 2 0 010 2.828l-8.486 8.485M7 17h.01" />
            </svg>
        )
    },
    {
        id: 'archives',
        label: 'Archives',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20 7H4a1 1 0 01-1-1V5a1 1 0 011-1h16a1 1 0 011 1v1a1 1 0 01-1 1zM6 10h12l-1 9a2 2 0 01-2 2H9a2 2 0 01-2-2l-1-9z" />
            </svg>
        )
    },
    {
        id: 'keyboard',
        label: 'Keyboard Shortcuts',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 4a2 2 0 114 0v1a1 1 0 001 1h3a1 1 0 011 1v3a1 1 0 01-1 1h-1a2 2 0 100 4h1a1 1 0 011 1v3a1 1 0 01-1 1h-3a1 1 0 01-1-1v-1a2 2 0 10-4 0v1a1 1 0 01-1 1h-3a1 1 0 01-1-1v-3a1 1 0 011-1h1a2 2 0 100-4H7a1 1 0 01-1-1V7a1 1 0 011-1h3a1 1 0 001-1V4z" />
            </svg>
        )
    },
    {
        id: 'environment',
        label: 'Agent Configuration',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
            </svg>
        )
    },
    {
        id: 'projects',
        label: 'Project Settings',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 7v10a2 2 0 002 2h14a2 2 0 002-2V9a2 2 0 00-2-2h-6l-2-2H5a2 2 0 00-2 2z" />
            </svg>
        )
    },
    {
        id: 'terminal',
        label: 'Terminal',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
            </svg>
        )
    },
    {
        id: 'sessions',
        label: 'Sessions',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
        )
    },
    {
        id: 'actions',
        label: 'Action Buttons',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6V4m0 2a2 2 0 100 4m0-4a2 2 0 110 4m-6 8a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4m6 6v10m6-2a2 2 0 100-4m0 4a2 2 0 100 4m0-4v2m0-6V4" />
            </svg>
        )
    },
    {
        id: 'version',
        label: 'Version',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
            </svg>
        )
    },
]

interface ProjectSettings {
    setupScript: string
    environmentVariables: Array<{key: string, value: string}>
}

interface RunScript {
    command: string
    workingDirectory?: string
    environmentVariables: Record<string, string>
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

export function SettingsModal({ open, onClose, onOpenTutorial }: Props) {
    const { terminalFontSize, uiFontSize, setTerminalFontSize, setUiFontSize } = useFontSize()
    const { applyOverrides: applyShortcutOverrides } = useKeyboardShortcutsConfig()
    const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance')
    const [activeAgentTab, setActiveAgentTab] = useState<AgentType>('claude')
    const [projectPath, setProjectPath] = useState<string>('')
    const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
        setupScript: '',
        environmentVariables: []
    })
    const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>({
        shell: null,
        shellArgs: [],
        fontFamily: null,
    })
    const [sessionPreferences, setSessionPreferences] = useState<SessionPreferences>({
        auto_commit_on_review: false,
        skip_confirmation_modals: false
    })
    const platform = useMemo(() => detectPlatformSafe(), [])

    const [keyboardShortcutsState, setKeyboardShortcutsState] = useState<KeyboardShortcutConfig>(() => mergeShortcutConfig(defaultShortcutConfig))
    const [editableKeyboardShortcuts, setEditableKeyboardShortcuts] = useState<KeyboardShortcutConfig>(() => mergeShortcutConfig(defaultShortcutConfig))
    const [shortcutRecording, setShortcutRecording] = useState<KeyboardShortcutAction | null>(null)
    const [shortcutsDirty, setShortcutsDirty] = useState(false)
    const recordingLabel = useMemo(() => {
        if (!shortcutRecording) return ''
        for (const section of KEYBOARD_SHORTCUT_SECTIONS) {
            const match = section.items.find(item => item.action === shortcutRecording)
            if (match) return match.label
        }
        return ''
    }, [shortcutRecording])

    const renderShortcutTokens = (binding: string) => {
        if (!binding) {
            return <span className="text-caption text-slate-500">Not set</span>
        }

        const segments = splitShortcutBinding(binding)
        return (
            <span className="flex flex-wrap items-center gap-1">
                {segments.map((segment, index) => {
                    const label = getDisplayLabelForSegment(segment, platform)
                    return (
                        <kbd
                            key={`${segment}-${index}`}
                            className="px-2 py-1 bg-slate-800/70 border border-slate-700/60 rounded text-caption text-slate-200"
                        >
                            {label}
                        </kbd>
                    )
                })}
            </span>
        )
    }
    const [showFontPicker, setShowFontPicker] = useState(false)
    const [runScript, setRunScript] = useState<RunScript>({
        command: '',
        workingDirectory: '',
        environmentVariables: {}
    })
    const [envVars, setEnvVars] = useState<Record<AgentType, Array<{key: string, value: string}>>>({
        claude: [],
        opencode: [],
        gemini: [],
        codex: []
    })
    const [cliArgs, setCliArgs] = useState<Record<AgentType, string>>({
        claude: '',
        opencode: '',
        gemini: '',
        codex: ''
    })
    const [binaryConfigs, setBinaryConfigs] = useState<Record<AgentType, AgentBinaryConfig>>({
        claude: { agent_name: 'claude', custom_path: null, auto_detect: true, detected_binaries: [] },
        opencode: { agent_name: 'opencode', custom_path: null, auto_detect: true, detected_binaries: [] },
        gemini: { agent_name: 'gemini', custom_path: null, auto_detect: true, detected_binaries: [] },
        codex: { agent_name: 'codex', custom_path: null, auto_detect: true, detected_binaries: [] }
    })
    const [notification, setNotification] = useState<NotificationState>({
        message: '',
        type: 'info',
        visible: false
    })
    const [appVersion, setAppVersion] = useState<string>('')

    const [selectedSpec, setSelectedSpec] = useState<{ name: string; content: string } | null>(null)

    const displayNameForAgent = useCallback((agent: AgentType) => {
        if (agent === 'opencode') return 'OpenCode'
        if (agent === 'codex') return 'Codex'
        if (agent === 'gemini') return 'Gemini'
        return 'Claude'
    }, [])

    const {
        loading,
        saving,
        saveAllSettings,
        loadEnvVars,
        loadCliArgs,
        loadProjectSettings,
        loadTerminalSettings,
        loadSessionPreferences,
        loadKeyboardShortcuts,
        saveKeyboardShortcuts,
        loadInstalledFonts
    } = useSettings()
    
    const {
        actionButtons,
        saveActionButtons,
        resetToDefaults
    } = useActionButtons()
    
    const [editableActionButtons, setEditableActionButtons] = useState<HeaderActionConfig[]>([])
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    
    const hideNotification = () => setNotification(prev => ({ ...prev, visible: false }))
    const scheduleHideNotification = (delayMs: number = 3000) => window.setTimeout(hideNotification, delayMs)
    const showNotification = (message: string, type: NotificationType) => {
        setNotification({ message, type, visible: true })
        scheduleHideNotification(3000)
    }

    // Normalize smart dashes some platforms insert automatically (Safari/macOS)
    // so CLI flags like "--model" are preserved as two ASCII hyphens.
    const loadRunScript = useCallback(async (): Promise<RunScript> => {
        try {
            const result = await invoke<RunScript | null>(TauriCommands.GetProjectRunScript)
            if (result) {
                return result
            }
        } catch (error) {
            logger.info('Failed to load run script:', error)
        }
        return {
            command: '',
            workingDirectory: '',
            environmentVariables: {}
        }
    }, [])
    
    // JS normalizers removed; native fix handles inputs globally.


    // Load app version when the version category is opened
    useEffect(() => {
        const loadVersion = async () => {
            if (activeCategory !== 'version') return
            try {
                const version = await invoke<string>(TauriCommands.GetAppVersion)
                setAppVersion(version)
            } catch (error) {
                logger.error('Failed to load app version:', error)
            }
        }
        loadVersion()
    }, [activeCategory])

    // Sync action buttons when modal opens or buttons change
    useEffect(() => {
        if (open) {
            setEditableActionButtons([...actionButtons])
            // Only reset unsaved changes flag when modal first opens
            if (!hasUnsavedChanges) {
                setHasUnsavedChanges(false)
            }
        }
    }, [open, actionButtons, hasUnsavedChanges])
    
    // Update editable buttons when the source actionButtons change (after reload)
    useEffect(() => {
        if (!hasUnsavedChanges) {
            setEditableActionButtons([...actionButtons])
        }
    }, [actionButtons, hasUnsavedChanges])

    const loadBinaryConfigs = useCallback(async () => {
        try {
            logger.info('Loading binary configurations...')
            const configs = await invoke<AgentBinaryConfig[]>(TauriCommands.GetAllAgentBinaryConfigs)
            logger.info('Received binary configurations:', configs)
            
            const configMap: Record<AgentType, AgentBinaryConfig> = {
                claude: { agent_name: 'claude', custom_path: null, auto_detect: true, detected_binaries: [] },
                opencode: { agent_name: 'opencode', custom_path: null, auto_detect: true, detected_binaries: [] },
                gemini: { agent_name: 'gemini', custom_path: null, auto_detect: true, detected_binaries: [] },
                codex: { agent_name: 'codex', custom_path: null, auto_detect: true, detected_binaries: [] }
            }

            for (const config of configs) {
                const agent = config.agent_name as AgentType
                if (agent && configMap[agent]) {
                    configMap[agent] = config
                    logger.info(`Loaded config for ${agent}:`, config)
                }
            }
            
            logger.info('Final configMap:', configMap)
            setBinaryConfigs(configMap)
        } catch (error) {
            logger.error('Failed to load binary configurations:', error)
        }
    }, [])
    
    const loadAllSettings = useCallback(async () => {
        // Load application-level settings (always available)
        const [loadedEnvVars, loadedCliArgs, loadedSessionPreferences, loadedShortcuts] = await Promise.all([
            loadEnvVars(),
            loadCliArgs(),
            loadSessionPreferences(),
            loadKeyboardShortcuts(),
        ])
        
        // Load project-specific settings (may fail if no project is open)
        let loadedProjectSettings: ProjectSettings = { setupScript: '', environmentVariables: [] }
        let loadedTerminalSettings: TerminalSettings = { shell: null, shellArgs: [], fontFamily: null }
        let loadedRunScript: RunScript = { command: '', workingDirectory: '', environmentVariables: {} }
        
        try {
            const results = await Promise.allSettled([
                loadProjectSettings(),
                loadTerminalSettings(),
                loadRunScript()
            ])
            
            if (results[0].status === 'fulfilled') {
                loadedProjectSettings = results[0].value
            }
            if (results[1].status === 'fulfilled') {
                loadedTerminalSettings = results[1].value
            }
            if (results[2].status === 'fulfilled') {
                loadedRunScript = results[2].value
            }
        } catch (error) {
            // Project settings not available (likely no project open) - use defaults
            logger.info('Project settings not available (no active project):', error)
        }
        
        setEnvVars(loadedEnvVars)
        setCliArgs(loadedCliArgs)
        setProjectSettings(loadedProjectSettings)
        setTerminalSettings(loadedTerminalSettings)
        setSessionPreferences(loadedSessionPreferences)
        setRunScript(loadedRunScript)
        const normalizedShortcuts = mergeShortcutConfig(loadedShortcuts)
        setKeyboardShortcutsState(normalizedShortcuts)
        setEditableKeyboardShortcuts(normalizedShortcuts)
        setShortcutsDirty(false)
        applyShortcutOverrides(normalizedShortcuts)
        
        loadBinaryConfigs()
    }, [loadEnvVars, loadCliArgs, loadSessionPreferences, loadKeyboardShortcuts, loadProjectSettings, loadTerminalSettings, loadRunScript, loadBinaryConfigs, applyShortcutOverrides])

    useEffect(() => {
        if (open) {
            loadAllSettings()
            // Also load the project path for MCP settings
            invoke<string | null>(TauriCommands.GetActiveProjectPath).then(path => {
                if (path) setProjectPath(path)
            })
        }
    }, [open, loadAllSettings])

    useEffect(() => {
        if (!shortcutRecording) return
        const action = shortcutRecording

        const handleKeyCapture = (event: KeyboardEvent) => {
            event.preventDefault()
            event.stopPropagation()

            if (event.key === 'Escape') {
                setShortcutRecording(null)
                return
            }

            const rawBinding = shortcutFromEvent(event, { platform })
            const normalized = normalizeShortcut(rawBinding)
            if (!normalized) {
                return
            }

            const segments = normalized.split('+')
            const hasNonModifier = segments.some(seg => !['Mod', 'Meta', 'Ctrl', 'Alt', 'Shift'].includes(seg))

            if (!hasNonModifier) {
                return
            }

            setEditableKeyboardShortcuts(prev => {
                const next = { ...prev, [action]: [normalized] }
                setShortcutsDirty(!shortcutConfigsEqual(next, keyboardShortcutsState))
                return next
            })
            setShortcutRecording(null)
        }

        window.addEventListener('keydown', handleKeyCapture, true)

        return () => {
            window.removeEventListener('keydown', handleKeyCapture, true)
        }
    }, [shortcutRecording, keyboardShortcutsState, platform])

    const setShortcutBindings = useCallback((action: KeyboardShortcutAction, bindings: string[]) => {
        const sanitized = bindings
            .map(binding => normalizeShortcut(binding))
            .filter(Boolean)

        setEditableKeyboardShortcuts(prev => {
            const next = { ...prev, [action]: sanitized }
            setShortcutsDirty(!shortcutConfigsEqual(next, keyboardShortcutsState))
            return next
        })
    }, [keyboardShortcutsState])

    const handleShortcutReset = useCallback((action: KeyboardShortcutAction) => {
        setShortcutBindings(action, defaultShortcutConfig[action])
    }, [setShortcutBindings])

    const handleShortcutClear = useCallback((action: KeyboardShortcutAction) => {
        setShortcutBindings(action, [])
    }, [setShortcutBindings])

    const handleShortcutInputChange = useCallback((action: KeyboardShortcutAction, value: string) => {
        if (!value.trim()) {
            setShortcutBindings(action, [])
            return
        }
        setShortcutBindings(action, [value])
    }, [setShortcutBindings])

    const handleShortcutRecord = useCallback((action: KeyboardShortcutAction) => {
        setShortcutRecording(current => current === action ? null : action)
    }, [])

    const handleResetAllShortcuts = useCallback(() => {
        const reset = mergeShortcutConfig(defaultShortcutConfig)
        setEditableKeyboardShortcuts(reset)
        setShortcutsDirty(!shortcutConfigsEqual(reset, keyboardShortcutsState))
    }, [keyboardShortcutsState])

    const handleBinaryPathChange = async (agent: AgentType, path: string | null) => {
        try {
            await invoke(TauriCommands.SetAgentBinaryPath, { 
                agentName: agent, 
                path: path || null 
            })
            
            const updatedConfig = await invoke<AgentBinaryConfig>(TauriCommands.GetAgentBinaryConfig, { agentName: agent })
            setBinaryConfigs(prev => ({
                ...prev,
                [agent]: updatedConfig
            }))
        } catch (error) {
            logger.error(`Failed to update binary path for ${agent}:`, error)
            showNotification(`Failed to update binary path: ${error}`, 'error')
        }
    }

    const handleRefreshBinaryDetection = async (agent: AgentType) => {
        try {
            const updatedConfig = await invoke<AgentBinaryConfig>(TauriCommands.RefreshAgentBinaryDetection, { agentName: agent })
            setBinaryConfigs(prev => ({
                ...prev,
                [agent]: updatedConfig
            }))
        } catch (error) {
            logger.error(`Failed to refresh binary detection for ${agent}:`, error)
        }
    }

    const openFilePicker = async (agent: AgentType) => {
        try {
            const selected = await openDialog({
                title: `Select ${agent} binary`,
                multiple: false,
                directory: false
            })
            
            if (selected) {
                await handleBinaryPathChange(agent, selected as string)
            }
        } catch (error) {
            logger.error('Failed to open file picker:', error)
            showNotification(`Failed to open file picker: ${error}`, 'error')
        }
    }

    // Run Script env var handlers
    const handleRunEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
        const entries = Object.entries(runScript.environmentVariables || {})
        const next = entries.map(([k, v], i) => i === index ? [field === 'key' ? value : k, field === 'value' ? value : v] : [k, v])
        const obj = Object.fromEntries(next)
        setRunScript(prev => ({ ...prev, environmentVariables: obj }))
    }
    const handleAddRunEnvVar = () => {
        const entries = Object.entries(runScript.environmentVariables || {})
        entries.push(['', ''])
        setRunScript(prev => ({ ...prev, environmentVariables: Object.fromEntries(entries) }))
    }
    const handleRemoveRunEnvVar = (index: number) => {
        const entries = Object.entries(runScript.environmentVariables || {})
        const next = entries.filter((_, i) => i !== index)
        setRunScript(prev => ({ ...prev, environmentVariables: Object.fromEntries(next) }))
    }

    const handleSave = async () => {
        const result = await saveAllSettings(envVars, cliArgs, projectSettings, terminalSettings, sessionPreferences)
        
        // Save run script
        try {
            await invoke(TauriCommands.SetProjectRunScript, { runScript })
            result.savedSettings.push('run script')
        } catch (error) {
            logger.info('Run script not saved - requires active project', error)
        }
        
        // Save action buttons if they've been modified
        if (hasUnsavedChanges) {
            // Ensure color is explicitly present (avoid undefined getting dropped over invoke)
            const normalizedButtons = editableActionButtons.map(b => ({
                ...b,
                color: b.color ?? 'slate',
            }))
            logger.info('Saving action buttons from SettingsModal:', normalizedButtons)
            const success = await saveActionButtons(normalizedButtons)
            if (!success) {
                result.failedSettings.push('action buttons')
            } else {
                try {
                    // Re-fetch persisted buttons to ensure modal reflects canonical state
                    const latest = await invoke<HeaderActionConfig[]>(TauriCommands.GetProjectActionButtons)
                    setEditableActionButtons(latest)
                } catch (e) {
                    logger.warn('Failed to reload action buttons after save', e)
                }
            }
        }

        if (shortcutsDirty) {
            try {
                const normalizedShortcuts = mergeShortcutConfig(editableKeyboardShortcuts)
                await saveKeyboardShortcuts(normalizedShortcuts)
                setKeyboardShortcutsState(normalizedShortcuts)
                setEditableKeyboardShortcuts(normalizedShortcuts)
                applyShortcutOverrides(normalizedShortcuts)
                setShortcutsDirty(false)
                result.savedSettings.push('keyboard shortcuts')
            } catch (error) {
                logger.error('Failed to save keyboard shortcuts:', error)
                result.failedSettings.push('keyboard shortcuts')
            }
        }
        
        if (result.failedSettings.length > 0) {
            showNotification(`Failed to save: ${result.failedSettings.join(', ')}`, 'error')
        } else if (result.savedSettings.length > 0 || hasUnsavedChanges) {
            showNotification(`Settings saved successfully`, 'success')
            setHasUnsavedChanges(false)
        }
        
        onClose()
    }

    const renderArchivesSettings = () => (
        <SettingsArchivesSection
            onClose={onClose}
            onOpenSpec={(spec) => setSelectedSpec(spec)}
            onNotify={showNotification}
        />
    )

    const handleAddEnvVar = (agent: AgentType) => {
        setEnvVars(prev => ({
            ...prev,
            [agent]: [...prev[agent], { key: '', value: '' }]
        }))
    }

    const handleRemoveEnvVar = (agent: AgentType, index: number) => {
        setEnvVars(prev => ({
            ...prev,
            [agent]: prev[agent].filter((_, i) => i !== index)
        }))
    }

    const handleEnvVarChange = (agent: AgentType, index: number, field: 'key' | 'value', value: string) => {
        setEnvVars(prev => ({
            ...prev,
            [agent]: prev[agent].map((item, i) => 
                i === index ? { ...item, [field]: value } : item
            )
        }))
    }
    
    const handleAddProjectEnvVar = () => {
        setProjectSettings(prev => ({
            ...prev,
            environmentVariables: [...prev.environmentVariables, { key: '', value: '' }]
        }))
    }
    
    const handleRemoveProjectEnvVar = (index: number) => {
        setProjectSettings(prev => ({
            ...prev,
            environmentVariables: prev.environmentVariables.filter((_, i) => i !== index)
        }))
    }
    
    const handleProjectEnvVarChange = (index: number, field: 'key' | 'value', value: string) => {
        setProjectSettings(prev => ({
            ...prev,
            environmentVariables: prev.environmentVariables.map((item, i) => 
                i === index ? { ...item, [field]: value } : item
            )
        }))
    }

    useEffect(() => {
        if (!open) return

        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
            }
        }

        window.addEventListener('keydown', handleKeyDown)
        return () => window.removeEventListener('keydown', handleKeyDown)
    }, [open, onClose])

    if (!open) return null

    const renderEnvironmentSettings = () => (
        <div className="flex flex-col h-full">
            <div className="border-b border-slate-800">
                <div className="flex">
                    {(['claude', 'opencode', 'gemini', 'codex'] as AgentType[]).map(agent => (
                        <button
                            key={agent}
                            onClick={() => setActiveAgentTab(agent)}
                             className={`px-6 py-3 text-body font-medium transition-colors capitalize ${
                                 activeAgentTab === agent
                                     ? `text-slate-200 border-b-2 ${theme.colors.border.focus}`
                                     : 'text-slate-400 hover:text-slate-300'
                             }`}
                        >
                            {displayNameForAgent(agent)}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                     {/* MCP Configuration for Claude/Codex/OpenCode */}
                     {projectPath && (activeAgentTab === 'claude' || activeAgentTab === 'codex' || activeAgentTab === 'opencode') && (
                         <div>
                             <MCPConfigPanel projectPath={projectPath} agent={activeAgentTab} />
                         </div>
                     )}

                    {/* Binary Path Configuration */}
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-2">Binary Path</h3>
                        <div className="text-body text-slate-400 mb-4">
                            Configure which {displayNameForAgent(activeAgentTab)} binary to use. 
                            Auto-detection finds all installed versions and recommends the best one.
                            <span className="block mt-2 text-caption text-slate-500">
                                Note: Agent binary configurations are stored globally and apply to all projects.
                            </span>
                        </div>

                        {/* Current Configuration */}
                        <div className="mb-4 p-3 bg-slate-800 rounded border border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-caption text-slate-400">Current Binary</span>
                                <button
                                    onClick={() => handleRefreshBinaryDetection(activeAgentTab)}
                                     className={`text-caption ${theme.colors.accent.blue.DEFAULT} hover:${theme.colors.accent.cyan.light} transition-colors`}
                                    title="Refresh detection"
                                >
                                    <svg className="w-4 h-4 inline mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                                    </svg>
                                    Refresh
                                </button>
                            </div>
                            
                            {binaryConfigs[activeAgentTab].custom_path ? (
                                <div className="space-y-2">
                                    <div className="font-mono text-body text-green-400">
                                        {binaryConfigs[activeAgentTab].custom_path}
                                    </div>
                                    <div className="text-caption text-slate-500">Custom path (user configured)</div>
                                    <button
                                        onClick={() => handleBinaryPathChange(activeAgentTab, null)}
                                        className="text-caption text-orange-400 hover:text-orange-300 transition-colors"
                                    >
                                        Reset to auto-detection
                                    </button>
                                </div>
                            ) : binaryConfigs[activeAgentTab].detected_binaries.length > 0 ? (
                                <div className="space-y-2">
                                    {(() => {
                                        const recommended = binaryConfigs[activeAgentTab].detected_binaries.find(b => b.is_recommended)
                                        return recommended ? (
                                            <div>
                                                <div className="font-mono text-body text-slate-200">
                                                    {recommended.path}
                                                </div>
                                                <div className="flex items-center gap-2 text-caption">
                                                    <span className="text-green-400">✓ Recommended</span>
                                                    <span className="text-slate-500">•</span>
                                                    <span className="text-slate-400">{recommended.installation_method}</span>
                                                    {recommended.version && (
                                                        <>
                                                            <span className="text-slate-500">•</span>
                                                            <span className="text-slate-400">{recommended.version}</span>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        ) : (
                                            <div className="text-body text-slate-400">
                                                {binaryConfigs[activeAgentTab].detected_binaries[0].path}
                                            </div>
                                        )
                                    })()}
                                </div>
                            ) : (
                                <div className="text-body text-yellow-400">
                                    No {activeAgentTab} binary detected
                                </div>
                            )}
                        </div>

                        {/* Custom Binary Path Input */}
                        <div className="space-y-3">
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    value={binaryConfigs[activeAgentTab].custom_path || ''}
                                    onChange={(e) => handleBinaryPathChange(activeAgentTab, e.target.value || null)}
                                    placeholder={binaryConfigs[activeAgentTab].detected_binaries.find(b => b.is_recommended)?.path || `Path to ${displayNameForAgent(activeAgentTab)} binary`}
                                    className="flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-body"
                                />
                                <button
                                    onClick={() => openFilePicker(activeAgentTab)}
                                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded border border-slate-600 text-body transition-colors"
                                    title="Browse for binary"
                                >
                                    Browse
                                </button>
                            </div>

                            {/* Detected Binaries List */}
                            {binaryConfigs[activeAgentTab].detected_binaries.length > 0 && (
                                <div className="mt-4">
                                    <h4 className="text-caption font-medium text-slate-300 mb-2">Detected Binaries</h4>
                                    <div className="space-y-1 max-h-32 overflow-y-auto">
                                        {binaryConfigs[activeAgentTab].detected_binaries.map((binary, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center justify-between p-2 bg-slate-800 rounded border border-slate-700 hover:border-slate-600 transition-colors cursor-pointer"
                                                onClick={() => handleBinaryPathChange(activeAgentTab, binary.path)}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-mono text-caption text-slate-200 truncate">
                                                        {binary.path}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-caption mt-1">
                                                        {binary.is_recommended && (
                                                            <span className="text-green-400">Recommended</span>
                                                        )}
                                                        <span className="text-slate-400">{binary.installation_method}</span>
                                                        {binary.version && (
                                                            <>
                                                                <span className="text-slate-500">•</span>
                                                                <span className="text-slate-400">{binary.version}</span>
                                                            </>
                                                        )}
                                                        {binary.is_symlink && binary.symlink_target && (
                                                            <>
                                                                <span className="text-slate-500">•</span>
                                                                 <span className={theme.colors.accent.blue.DEFAULT}>→ {binary.symlink_target}</span>
                                                            </>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="border-t border-slate-700 pt-6">
                        <h3 className="text-body font-medium text-slate-200 mb-2">CLI Arguments</h3>
                        <div className="text-body text-slate-400 mb-3">
                            Add custom command-line arguments that will be appended to the {displayNameForAgent(activeAgentTab)} command.
                        </div>
                        <input
                            type="text"
                            value={cliArgs[activeAgentTab]}
                            onChange={(e) => setCliArgs(prev => ({ ...prev, [activeAgentTab]: e.target.value }))}
                            placeholder="e.g., --profile test or -p some 'quoted value'"
                            className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-body"
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            inputMode="text"
                            style={{ fontVariantLigatures: 'none' }}
                        />
                        <div className="mt-2 text-caption text-slate-500">
                             Examples: <code className={theme.colors.accent.blue.DEFAULT}>--profile test</code>, <code className={theme.colors.accent.blue.DEFAULT}>-d</code>, <code className={theme.colors.accent.blue.DEFAULT}>--model gpt-4</code>
                        </div>
                    </div>

                    <div className="border-t border-slate-700 pt-6">
                        <h3 className="text-body font-medium text-slate-200 mb-2">Environment Variables</h3>
                        <div className="text-body text-slate-400 mb-4">
                            Configure environment variables for {displayNameForAgent(activeAgentTab)} agent. 
                            These variables will be available when starting agents with this agent type.
                        </div>

                        <div className="space-y-3">
                            {envVars[activeAgentTab].map((item, index) => (
                                <div key={index} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={item.key}
                                        onChange={(e) => handleEnvVarChange(activeAgentTab, index, 'key', e.target.value)}
                                        placeholder="Variable name (e.g., API_KEY)"
                                        className="flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        autoComplete="off"
                                        spellCheck={false}
                                        inputMode="text"
                                        style={{ fontVariantLigatures: 'none' }}
                                    />
                                    <input
                                        type="text"
                                        value={item.value}
                                        onChange={(e) => handleEnvVarChange(activeAgentTab, index, 'value', e.target.value)}
                                        placeholder="Value"
                                        className="flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500"
                                        autoCorrect="off"
                                        autoCapitalize="off"
                                        autoComplete="off"
                                        spellCheck={false}
                                        inputMode="text"
                                        style={{ fontVariantLigatures: 'none' }}
                                    />
                                    <button
                                        onClick={() => handleRemoveEnvVar(activeAgentTab, index)}
                                        className="px-3 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-400 hover:text-red-400"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                        </div>

                        <button
                            onClick={() => handleAddEnvVar(activeAgentTab)}
                            className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-300"
                        >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
                            </svg>
                            Add Environment Variable
                        </button>
                    </div>

                    {activeAgentTab === 'claude' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong>Common Claude CLI arguments:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><code>-d</code> or <code>--dangerously-skip-permissions</code> - Skip permission prompts</li>
                                    <li><code>--profile test</code> - Use a specific profile</li>
                                    <li><code>--model claude-3-opus-20240229</code> - Specify model</li>
                                </ul>
                                <strong className="block mt-3">Common environment variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>ANTHROPIC_API_KEY - Your Anthropic API key</li>
                                    <li>CLAUDE_MODEL - Model to use</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeAgentTab === 'opencode' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong>Common OpenCode CLI arguments:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><code>--model gpt-4-turbo</code> - Specify OpenAI model</li>
                                    <li><code>--temperature 0.7</code> - Set temperature</li>
                                </ul>
                                <strong className="block mt-3">Common environment variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>OPENAI_API_KEY - Your OpenAI API key</li>
                                    <li>OPENCODE_MODEL - Model to use</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeAgentTab === 'gemini' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong>Common Gemini CLI arguments:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><code>--model gemini-1.5-pro</code> - Specify Gemini model</li>
                                    <li><code>--temperature 0.9</code> - Set temperature</li>
                                </ul>
                                <strong className="block mt-3">Common environment variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>GOOGLE_API_KEY - Your Google AI Studio API key</li>
                                    <li>GEMINI_MODEL - Model to use</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeAgentTab === 'codex' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong>Common Codex CLI arguments:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><code>--sandbox workspace-write</code> - Workspace write access</li>
                                    <li><code>--sandbox danger-full-access</code> - Full system access</li>
                                    <li><code>--model o3</code> - Use specific model</li>
                                </ul>
                                <strong className="block mt-3">Common environment variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>OPENAI_API_KEY - Your OpenAI API key (if using OpenAI models)</li>
                                    <li>CODEX_MODEL - Model to use (e.g., o3, gpt-4)</li>
                                    <li>CODEX_PROFILE - Configuration profile to use</li>
                                </ul>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )


    const renderProjectSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-4">
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-2">Worktree Setup Script</h3>
                        <div className="text-body text-slate-400 mb-4">
                            Configure a script that runs automatically when a new worktree is created for this project.
                            The script will be executed in the new worktree directory.
                        </div>
                        
                        <div className="mb-4 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400 mb-2">
                                <strong>Available variables:</strong>
                            </div>
                            <ul className="text-caption text-slate-500 space-y-1 list-disc list-inside">
                                 <li><code className={theme.colors.accent.blue.DEFAULT}>$WORKTREE_PATH</code> - Path to the new worktree</li>
                                 <li><code className={theme.colors.accent.blue.DEFAULT}>$REPO_PATH</code> - Path to the main repository</li>
                                 <li><code className={theme.colors.accent.blue.DEFAULT}>$SESSION_NAME</code> - Name of the agent</li>
                                 <li><code className={theme.colors.accent.blue.DEFAULT}>$BRANCH_NAME</code> - Name of the new branch</li>
                            </ul>
                        </div>

                        <div className="relative">
                            <textarea
                                value={projectSettings.setupScript}
                                onChange={(e) => setProjectSettings({ ...projectSettings, setupScript: e.target.value })}
                                placeholder={`#!/bin/bash
# Example: Copy .env file from main repo
if [ -f "$REPO_PATH/.env" ]; then
    cp "$REPO_PATH/.env" "$WORKTREE_PATH/.env"
    echo "✓ Copied .env file to worktree"
fi`}
                                 className={`w-full h-48 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-body resize-none overflow-auto focus:outline-none focus:${theme.colors.border.focus} transition-colors scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800`}
                                spellCheck={false}
                                style={{ 
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: `${theme.colors.border.strong} ${theme.colors.background.elevated}`
                                }}
                            />
                        </div>
                        
                         <div className={`mt-4 p-3 ${theme.colors.accent.cyan.bg} border ${theme.colors.accent.cyan.border} rounded`}>
                             <div className={`text-caption ${theme.colors.accent.cyan.light} mb-2`}>
                                <strong>Example use cases:</strong>
                            </div>
                            <ul className="text-caption text-slate-400 space-y-1 list-disc list-inside">
                                <li>Copy environment files (.env, .env.local)</li>
                                <li>Install dependencies (npm install, pip install)</li>
                                <li>Set up database connections</li>
                                <li>Configure IDE settings</li>
                                <li>Create required directories</li>
                            </ul>
                        </div>
                    </div>
                    {/* Run Script (Cmd+E) configuration */}
                    <div className="mt-8">
                        <h3 className="text-body font-medium text-slate-200 mb-2">Run Script</h3>
                        <div className="text-body text-slate-400 mb-4">
                            Configure the command executed by Run Mode (⌘E). When it finishes or is killed, the run terminal becomes read-only and shows the exit status.
                        </div>
                        <div className="space-y-3">
                            <div>
                                <label className="block text-caption text-slate-400 mb-1">Command</label>
                                 <input
                                     type="text"
                                     value={runScript.command}
                                     onChange={(e) => setRunScript(prev => ({ ...prev, command: e.target.value }))}
                                     placeholder="e.g., npm run dev"
                                     className={`w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:${theme.colors.border.focus} transition-colors`}
                                 />
                            </div>
                            <div>
                                <label className="block text-caption text-slate-400 mb-1">Working Directory (optional)</label>
                                 <input
                                     type="text"
                                     value={runScript.workingDirectory || ''}
                                     onChange={(e) => setRunScript(prev => ({ ...prev, workingDirectory: e.target.value }))}
                                     placeholder="Defaults to active project folder"
                                     className={`w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:${theme.colors.border.focus} transition-colors`}
                                 />
                            </div>
                            <div>
                                <label className="block text-caption text-slate-400 mb-2">Environment Variables</label>
                                <div className="space-y-2">
                                    {Object.entries(runScript.environmentVariables || {}).map(([k, v], index) => (
                                        <div key={index} className="flex gap-2">
                                             <input
                                                 type="text"
                                                 value={k}
                                                 onChange={(e) => handleRunEnvVarChange(index, 'key', e.target.value)}
                                                 placeholder="KEY"
                                                 className={`flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:${theme.colors.border.focus} transition-colors`}
                                             />
                                             <input
                                                 type="text"
                                                 value={v}
                                                 onChange={(e) => handleRunEnvVarChange(index, 'value', e.target.value)}
                                                 placeholder="value"
                                                 className={`flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:${theme.colors.border.focus} transition-colors`}
                                             />
                                            <button
                                                onClick={() => handleRemoveRunEnvVar(index)}
                                                className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-700 rounded transition-colors text-red-400"
                                            >
                                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={handleAddRunEnvVar}
                                        className="w-full mt-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-400 flex items-center justify-center gap-2"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                        </svg>
                                        Add Environment Variable
                                    </button>
                                </div>
                            </div>
                            <div className="p-3 bg-slate-800/50 border border-slate-700 rounded text-caption text-slate-500">
                                Tip: Use an npm script (e.g., "dev") or any shell command. The command runs in a dedicated read-only terminal and ends when the process exits.
                            </div>
                        </div>
                    </div>

                    <div className="mt-8">
                        <h3 className="text-body font-medium text-slate-200 mb-2">Project Environment Variables</h3>
                        <div className="text-body text-slate-400 mb-4">
                            Configure environment variables that will be set for all agents in this project.
                            These variables are applied to all terminals and agent processes.
                        </div>
                        
                        <div className="space-y-2">
                            {projectSettings.environmentVariables.map((envVar, index) => (
                                <div key={index} className="flex gap-2">
                                     <input
                                         type="text"
                                         value={envVar.key}
                                         onChange={(e) => handleProjectEnvVarChange(index, 'key', e.target.value)}
                                         placeholder="KEY"
                                         className={`flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:${theme.colors.border.focus} transition-colors`}
                                     />
                                     <input
                                         type="text"
                                         value={envVar.value}
                                         onChange={(e) => handleProjectEnvVarChange(index, 'value', e.target.value)}
                                         placeholder="value"
                                         className={`flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:${theme.colors.border.focus} transition-colors`}
                                     />
                                    <button
                                        onClick={() => handleRemoveProjectEnvVar(index)}
                                        className="px-3 py-2 bg-red-600/20 hover:bg-red-600/30 border border-red-700 rounded transition-colors text-red-400"
                                    >
                                        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                        </svg>
                                    </button>
                                </div>
                            ))}
                            
                            <button
                                onClick={handleAddProjectEnvVar}
                                className="w-full mt-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-400 flex items-center justify-center gap-2"
                            >
                                <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                Add Environment Variable
                            </button>
                        </div>
                        
                        <div className="mt-4 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong>Common project environment variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>API keys and tokens specific to this project</li>
                                    <li>Database connection strings</li>
                                    <li>Project-specific configuration paths</li>
                                    <li>Feature flags and debug settings</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    const renderAppearanceSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-4">Font Sizes</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center justify-between mb-2">
                                    <span className="text-body text-slate-300">Terminal Font Size</span>
                                    <span className="text-body text-slate-400">{terminalFontSize}px</span>
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min="8"
                                        max="24"
                                        value={terminalFontSize}
                                        onChange={(e) => setTerminalFontSize(Number(e.target.value))}
                                        className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
                                        style={{
                                            background: `linear-gradient(to right, ${theme.colors.accent.blue.DEFAULT} 0%, ${theme.colors.accent.blue.DEFAULT} ${((terminalFontSize - 8) / 16) * 100}%, ${theme.colors.background.active} ${((terminalFontSize - 8) / 16) * 100}%, ${theme.colors.background.active} 100%)`
                                        }}
                                    />
                                    <button
                                        onClick={() => setTerminalFontSize(13)}
                                        className="px-3 py-1 text-caption bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-400"
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                            
                            <div>
                                <label className="flex items-center justify-between mb-2">
                                    <span className="text-body text-slate-300">UI Font Size</span>
                                    <span className="text-body text-slate-400">{uiFontSize}px</span>
                                </label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="range"
                                        min="8"
                                        max="24"
                                        value={uiFontSize}
                                        onChange={(e) => setUiFontSize(Number(e.target.value))}
                                        className="flex-1 h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer slider"
                                        style={{
                                            background: `linear-gradient(to right, ${theme.colors.accent.blue.DEFAULT} 0%, ${theme.colors.accent.blue.DEFAULT} ${((uiFontSize - 8) / 16) * 100}%, ${theme.colors.background.active} ${((uiFontSize - 8) / 16) * 100}%, ${theme.colors.background.active} 100%)`
                                        }}
                                    />
                                    <button
                                        onClick={() => setUiFontSize(12)}
                                        className="px-3 py-1 text-caption bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-400"
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="mt-6">
                            <label className="block text-body text-slate-300 mb-2">Terminal Font Family</label>
                            <input
                                type="text"
                                value={terminalSettings.fontFamily || ''}
                                onChange={(e) => setTerminalSettings({ ...terminalSettings, fontFamily: e.target.value || null })}
                                placeholder='Examples: "JetBrains Mono, MesloLGS NF" or "Monaspace Neon"'
                                className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-body"
                            />
                            <div className="mt-2">
                                <button
                                    onClick={() => setShowFontPicker(v => !v)}
                                    className="px-3 py-1.5 text-caption bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-300"
                                >Browse installed fonts</button>
                            </div>
                            {showFontPicker && (
                                <FontPicker
                                    load={loadInstalledFonts}
                                    onSelect={(fam) => {
                                        setTerminalSettings(s => ({ ...s, fontFamily: fam }))
                                        setShowFontPicker(false)
                                    }}
                                    onClose={() => setShowFontPicker(false)}
                                />
                            )}
                            <div className="mt-2 text-caption text-slate-500">
                                Uses your system-installed fonts. Powerline/ glyphs need a Nerd Font. A safe fallback chain is applied automatically.
                            </div>
                        </div>

                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong>Keyboard shortcuts:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">Cmd/Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">+</kbd> Increase both font sizes</li>
                                    <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">Cmd/Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">-</kbd> Decrease both font sizes</li>
                                    <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">Cmd/Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">0</kbd> Reset both font sizes</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    
    const renderKeyboardShortcuts = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6 space-y-6">
                {shortcutRecording && (
                    <div className="px-4 py-3 rounded border border-amber-500/60 bg-amber-500/10 text-amber-100 text-body">
                        Press the new shortcut for <span className="font-semibold">{recordingLabel}</span> or press Escape to cancel.
                    </div>
                )}
                {KEYBOARD_SHORTCUT_SECTIONS.map(section => (
                    <div key={section.id} className="space-y-3">
                        <div className="flex items-center justify-between">
                            <h3 className="text-body font-medium text-slate-200">{section.title}</h3>
                        </div>
                        <div className="bg-slate-900/60 border border-slate-800 rounded-xl divide-y divide-slate-800/70">
                            {section.items.map(item => {
                                const currentValue = editableKeyboardShortcuts[item.action]?.[0] ?? ''
                                const isRecording = shortcutRecording === item.action

                                return (
                                    <div key={item.action} className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between px-5 py-4">
                                        <div>
                                            <div className="text-body text-slate-300">{item.label}</div>
                                            {item.description && (
                                                <div className="text-caption text-slate-500">{item.description}</div>
                                            )}
                                        </div>
                                        <div className="flex flex-col items-start gap-2 md:flex-row md:items-center md:gap-3">
                                            <div className="flex items-center gap-2 rounded-lg bg-slate-900/50 border border-slate-800 px-3 py-2">
                                                {renderShortcutTokens(currentValue)}
                                            </div>
                                            <input
                                                type="text"
                                                value={currentValue}
                                                onChange={(e) => handleShortcutInputChange(item.action, e.target.value)}
                                                placeholder="Type shortcut (e.g. Mod+Shift+S)"
                                                 className={`w-48 bg-slate-900/40 text-slate-100 border border-slate-700/70 rounded px-2.5 py-1.5 text-caption focus:outline-none focus:${theme.colors.border.focus}/80 disabled:opacity-60`}
                                                disabled={isRecording}
                                            />
                                            <button
                                                onClick={() => handleShortcutRecord(item.action)}
                                                 className={`px-2.5 py-1.5 text-caption rounded-lg border transition-colors ${
                                                     isRecording
                                                         ? `border-${theme.colors.accent.cyan.light} ${theme.colors.accent.cyan.light} ${theme.colors.accent.cyan.bg}`
                                                         : 'border-slate-600/70 text-slate-200 hover:border-slate-500 hover:bg-slate-800/50'
                                                 }`}
                                            >
                                                {isRecording ? 'Listening…' : 'Record'}
                                            </button>
                                            <button
                                                onClick={() => handleShortcutReset(item.action)}
                                                className="px-2.5 py-1.5 text-caption text-slate-300 border border-slate-600/70 rounded-lg hover:border-slate-500 hover:bg-slate-800/50"
                                            >
                                                Reset
                                            </button>
                                            <button
                                                onClick={() => handleShortcutClear(item.action)}
                                                className="px-2.5 py-1.5 text-caption text-slate-400 border border-slate-600/70 rounded-lg hover:border-slate-500 hover:bg-slate-800/50"
                                            >
                                                Clear
                                            </button>
                                        </div>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                ))}
                <div className="p-4 bg-slate-800/30 border border-slate-700 rounded text-caption text-slate-400">
                    Use <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">Ctrl</kbd> instead of <kbd className="px-1 py-0.5 bg-slate-700 rounded text-caption">Cmd</kbd> on Windows/Linux systems. Keyboard shortcuts apply globally throughout the application.
                </div>
            </div>
            <div className="border-t border-slate-800 p-4 bg-slate-900/50 flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <button
                        onClick={handleResetAllShortcuts}
                        className="px-3 py-1.5 text-caption rounded-lg border border-slate-700 text-slate-300 hover:border-slate-500 hover:bg-slate-800/50"
                    >
                        Reset All
                    </button>
                    {shortcutsDirty ? (
                        <span className="text-caption text-amber-300">Unsaved shortcut changes</span>
                    ) : (
                        <span className="text-caption text-slate-500">All shortcuts saved</span>
                    )}
                </div>
            </div>
        </div>
    )

    const renderTerminalSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-4">Terminal Shell Configuration</h3>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-body text-slate-300 mb-2">Shell Path</label>
                                <input
                                    type="text"
                                    value={terminalSettings.shell || ''}
                                    onChange={(e) => setTerminalSettings({ ...terminalSettings, shell: e.target.value || null })}
                                    placeholder="Leave empty to use system default ($SHELL)"
                                    className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-body"
                                />
                                <div className="mt-2 text-caption text-slate-500">
                                     Examples: <code className={theme.colors.accent.blue.DEFAULT}>/usr/local/bin/nu</code>, <code className={theme.colors.accent.blue.DEFAULT}>/opt/homebrew/bin/fish</code>, <code className={theme.colors.accent.blue.DEFAULT}>/bin/zsh</code>
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-body text-slate-300 mb-2">Shell Arguments</label>
                                <input
                                    type="text"
                                    value={(terminalSettings.shellArgs || []).join(' ')}
                                    onChange={(e) => {
                                        const raw = e.target.value
                                        const args = raw.trim() ? raw.split(' ') : []
                                        setTerminalSettings({ ...terminalSettings, shellArgs: args })
                                    }}
                                    placeholder="Default: -i (interactive mode)"
                                    className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-body"
                                />
                                <div className="mt-2 text-caption text-slate-500">
                                    Space-separated arguments passed to the shell. Leave empty for default interactive mode.
                                </div>
                            </div>
                        </div>
                        
                        <div className="mt-6 p-4 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong className="text-slate-300">Popular Shell Configurations:</strong>
                                <ul className="mt-3 space-y-2">
                                     <li className="flex items-start gap-2">
                                         <span className={theme.colors.accent.blue.DEFAULT}>Nushell:</span>
                                         <div>
                                             <div>Path: <code>/usr/local/bin/nu</code> or <code>/opt/homebrew/bin/nu</code></div>
                                             <div>Args: (leave empty, Nushell doesn't need -i)</div>
                                         </div>
                                     </li>
                                     <li className="flex items-start gap-2">
                                         <span className={theme.colors.accent.blue.DEFAULT}>Fish:</span>
                                         <div>
                                             <div>Path: <code>/usr/local/bin/fish</code> or <code>/opt/homebrew/bin/fish</code></div>
                                             <div>Args: <code>-i</code></div>
                                         </div>
                                     </li>
                                     <li className="flex items-start gap-2">
                                         <span className={theme.colors.accent.blue.DEFAULT}>Zsh:</span>
                                         <div>
                                             <div>Path: <code>/bin/zsh</code> or <code>/usr/bin/zsh</code></div>
                                             <div>Args: <code>-i</code></div>
                                         </div>
                                     </li>
                                     <li className="flex items-start gap-2">
                                         <span className={theme.colors.accent.blue.DEFAULT}>Bash:</span>
                                        <div>
                                            <div>Path: <code>/bin/bash</code> or <code>/usr/bin/bash</code></div>
                                            <div>Args: <code>-i</code></div>
                                        </div>
                                    </li>
                                </ul>
                                
                                <div className="mt-4 pt-3 border-t border-slate-600">
                                    <strong className="text-slate-300">Note:</strong> Changes will apply to new terminals only. Existing terminals will continue using their current shell.
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    const renderActionButtonsSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-4">Action Buttons</h3>
                        <p className="text-body text-slate-400 mb-4">
                            Configure custom action buttons that appear in the terminal header for both orchestrator and agent views.
                            These buttons provide quick access to common AI prompts that will be pasted directly into Claude.
                        </p>
                        
                         <div className={`${theme.colors.accent.cyan.bg} border ${theme.colors.accent.cyan.border} rounded p-3 mb-6`}>
                             <div className={`text-caption ${theme.colors.accent.cyan.light}`}>
                                 <strong>💡 How it works:</strong>
                                 <ul className={`mt-2 space-y-1 list-disc list-inside ${theme.colors.accent.cyan.DEFAULT}`}>
                                    <li>Click any action button to instantly paste its prompt into Claude</li>
                                    <li>Use keyboard shortcuts F1-F6 for even faster access</li>
                                    <li>Buttons appear next to "Agent" and "Reset" in the terminal header</li>
                                    <li>Maximum of 6 custom buttons allowed</li>
                                </ul>
                            </div>
                        </div>
                        
                        <div className="space-y-4">
                            {editableActionButtons.map((button, index) => (
                                <div key={button.id} className="bg-slate-800/50 border border-slate-700 rounded p-4">
                                    <div className="grid grid-cols-2 gap-4">
                                        <div>
                                            <label className="block text-body text-slate-300 mb-2">Label</label>
                                            <input
                                                type="text"
                                                value={button.label}
                                                onChange={(e) => {
                                                    const updated = [...editableActionButtons]
                                                    updated[index] = { ...button, label: e.target.value }
                                                    setEditableActionButtons(updated)
                                                    setHasUnsavedChanges(true)
                                                }}
                                                className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700"
                                                placeholder="Button Label"
                                            />
                                        </div>
                                        <div>
                                            <label className="block text-body text-slate-300 mb-2">Color</label>
                                            <select
                                                value={button.color || 'slate'}
                                                onChange={(e) => {
                                                    const updated = [...editableActionButtons]
                                                    updated[index] = { ...button, color: e.target.value }
                                                    setEditableActionButtons(updated)
                                                    setHasUnsavedChanges(true)
                                                }}
                                                className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700"
                                            >
                                                <option value="slate">Default (Slate)</option>
                                                <option value="green">Green</option>
                                                <option value="blue">Blue</option>
                                                <option value="amber">Amber</option>
                                            </select>
                                        </div>
                                    </div>
                                    <div className="mt-4">
                                        <label className="block text-body text-slate-300 mb-2">AI Prompt</label>
                                        <textarea
                                            value={button.prompt}
                                            onChange={(e) => {
                                                const updated = [...editableActionButtons]
                                                updated[index] = { ...button, prompt: e.target.value }
                                                setEditableActionButtons(updated)
                                                setHasUnsavedChanges(true)
                                            }}
                                            className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 font-mono text-body min-h-[80px] resize-y"
                                            placeholder="Enter the AI prompt that will be pasted into Claude chat..."
                                        />
                                    </div>
                                    <div className="mt-4 flex justify-end">
                                        <button
                                            onClick={() => {
                                                setEditableActionButtons(editableActionButtons.filter((_, i) => i !== index))
                                                setHasUnsavedChanges(true)
                                            }}
                                            className="text-red-400 hover:text-red-300 text-body flex items-center gap-1"
                                        >
                                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                            </svg>
                                            Remove
                                        </button>
                                    </div>
                                </div>
                            ))}
                            
                            {editableActionButtons.length < 6 ? (
                                <button
                                    onClick={() => {
                                        const newButton: HeaderActionConfig = {
                                            id: `custom-${Date.now()}`,
                                            label: 'New Action',
                                            prompt: '',
                                            color: 'slate',
                                        }
                                        setEditableActionButtons([...editableActionButtons, newButton])
                                        setHasUnsavedChanges(true)
                                    }}
                                    className="w-full border-2 border-dashed border-slate-600 rounded-lg p-4 text-slate-400 hover:text-slate-300 hover:border-slate-500 transition-colors flex items-center justify-center gap-2"
                                >
                                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                                </svg>
                                    Add New Action Button
                                </button>
                            ) : (
                                <div className="w-full border-2 border-dashed border-slate-700 rounded-lg p-4 text-slate-500 flex items-center justify-center gap-2">
                                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                                    </svg>
                                    Maximum of 6 action buttons allowed
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
            
            <div className="border-t border-slate-800 p-4 bg-slate-900/50">
                <div className="flex items-center justify-between">
                    <button
                        onClick={async () => {
                            const success = await resetToDefaults()
                            if (success) {
                                // State is automatically updated by resetToDefaults
                                setHasUnsavedChanges(false)
                                showNotification('Action buttons reset to defaults', 'success')
                            }
                        }}
                        className="text-slate-400 hover:text-slate-300 text-body"
                    >
                        Reset to Defaults
                    </button>
                </div>
            </div>
        </div>
    )
    

    const renderSessionSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-2">Session Review Settings</h3>
                        <div className="text-body text-slate-400 mb-4">
                            Configure how sessions are handled when marked as reviewed.
                        </div>
                        
                        <div className="space-y-4">
                            <label className="flex items-center gap-3 cursor-pointer">
                                  <input
                                      type="checkbox"
                                      checked={sessionPreferences.auto_commit_on_review}
                                       onChange={(e) => setSessionPreferences({
                                           ...sessionPreferences,
                                           auto_commit_on_review: e.target.checked
                                       })}
                                       className={`w-4 h-4 ${theme.colors.accent.cyan.dark} bg-slate-800 border-slate-600 rounded focus:ring-${theme.colors.accent.cyan.DEFAULT} focus:ring-2`}
                                 />
                                <div className="flex-1">
                                    <div className="text-body font-medium text-slate-200">
                                        Auto-commit on Review
                                    </div>
                                    <div className="text-caption text-slate-400 mt-1">
                                        Automatically commit all changes when marking a session as reviewed.
                                        When disabled, you'll be prompted to commit changes manually.
                                    </div>
                                </div>
                            </label>
                            
                            <label className="flex items-center gap-3 cursor-pointer">
                                  <input
                                      type="checkbox"
                                      checked={sessionPreferences.skip_confirmation_modals}
                                       onChange={(e) => setSessionPreferences({
                                           ...sessionPreferences,
                                           skip_confirmation_modals: e.target.checked
                                       })}
                                       className={`w-4 h-4 ${theme.colors.accent.cyan.dark} bg-slate-800 border-slate-600 rounded focus:ring-${theme.colors.accent.cyan.DEFAULT} focus:ring-2`}
                                 />
                                <div className="flex-1">
                                    <div className="text-body font-medium text-slate-200">
                                        Skip Confirmation Dialogs
                                    </div>
                                    <div className="text-caption text-slate-400 mt-1">
                                        Skip confirmation dialogs for actions that ask "Don't ask me again".
                                        When enabled, previously dismissed confirmations will be automatically applied.
                                    </div>
                                </div>
                            </label>
                        </div>
                        
                        <div className="mt-4 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-caption text-slate-400">
                                <strong>Auto-commit on Review:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>When enabled: Sessions with uncommitted changes are automatically committed when marked as reviewed</li>
                                    <li>When disabled: A confirmation dialog appears with the option to commit changes</li>
                                    <li>Commit message format: "Complete development work for {'{session_name}'}"</li>
                                    <li>All file types are included: modified, deleted, and new untracked files</li>
                                </ul>
                                
                                <div className="mt-3">
                                    <strong>Skip Confirmation Dialogs:</strong>
                                    <ul className="mt-2 space-y-1 list-disc list-inside">
                                        <li>Applies to dialogs that have "Don't ask me again" options</li>
                                        <li>When enabled, actions will proceed without confirmation</li>
                                        <li>Useful for experienced users who want faster workflow</li>
                                        <li>Can be toggled at any time to restore confirmation prompts</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    const renderVersionSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-body font-medium text-slate-200 mb-4">Application Information</h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between py-3 px-4 bg-slate-800/50 rounded-lg">
                                <div className="flex flex-col">
                                    <span className="text-body font-medium text-slate-200">Version</span>
                                    <span className="text-caption text-slate-400">Current application version</span>
                                </div>
                                <span className="text-body font-mono text-slate-300 bg-slate-900/50 px-3 py-1 rounded">
                                    {appVersion || 'Loading...'}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
    
    const renderSettingsContent = () => {
        switch (activeCategory) {
            case 'appearance':
                return renderAppearanceSettings()
            case 'keyboard':
                return renderKeyboardShortcuts()
            case 'environment':
                return renderEnvironmentSettings()
            case 'projects':
                return renderProjectSettings()
            case 'terminal':
                return renderTerminalSettings()
            case 'sessions':
                return renderSessionSettings()
            case 'archives':
                return renderArchivesSettings()
            case 'actions':
                return renderActionButtonsSettings()
            case 'version':
                return renderVersionSettings()
            default:
                return renderAppearanceSettings()
        }
    }

    return (
        <>
            {selectedSpec && (
                <SpecContentModal
                    specName={selectedSpec.name}
                    content={selectedSpec.content}
                    onClose={() => setSelectedSpec(null)}
                />
            )}
            {notification.visible && (
                 <div className={`fixed top-4 right-4 z-[60] px-4 py-3 rounded-lg shadow-lg transition-opacity duration-300 ${
                     notification.type === 'error' ? 'bg-red-900' :
                     notification.type === 'success' ? 'bg-green-900' : 'bg-slate-800'
                 }`} style={notification.type === 'info' ? { backgroundColor: theme.colors.status.info } : {}}>
                    <div className="text-white text-body">{notification.message}</div>
                </div>
            )}
            <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
                <div className="w-[1100px] max-w-[95vw] h-[700px] max-h-[85vh] bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden flex flex-col">
                {/* Header */}
                <div className="px-4 py-3 border-b border-slate-800 text-slate-200 font-medium flex items-center justify-between">
                    <span>Settings</span>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-200 transition-colors"
                    >
                        <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                {loading ? (
                    <div className="flex-1 flex items-center justify-center py-8">
                        <span className="text-body text-slate-300">Loading settings...</span>
                    </div>
                ) : (
                    <div className="flex-1 flex overflow-hidden">
                        {/* Sidebar */}
                        <div className="w-56 bg-slate-950/50 border-r border-slate-800 py-4">
                            <div className="px-3 mb-2">
                                <div className="text-caption font-medium text-slate-500 uppercase tracking-wider">Configuration</div>
                            </div>
                            <nav className="space-y-1 px-2">
                                {CATEGORIES.map(category => (
                                    <button
                                        key={category.id}
                                        onClick={() => setActiveCategory(category.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-2 text-body rounded-lg transition-colors ${
                                            activeCategory === category.id
                                                ? 'bg-slate-800 text-slate-200'
                                                : 'text-slate-400 hover:text-slate-300 hover:bg-slate-800/50'
                                        }`}
                                    >
                                        {category.icon}
                                        <span>{category.label}</span>
                                    </button>
                                ))}
                            </nav>
                            
                        </div>

                        {/* Content Area */}
                        <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                            {renderSettingsContent()}
                        </div>
                    </div>
                )}

                {/* Footer */}
                {!loading && (
                    <div className="px-4 py-3 border-t border-slate-800 flex justify-between">
                        <div className="flex gap-2">
                            {onOpenTutorial && (
                                <button
                                    onClick={() => {
                                        onOpenTutorial()
                                        onClose()
                                    }}
                                    className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-300 flex items-center gap-2"
                                    title="Open interactive tutorial"
                                >
                                    <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.746 0 3.332.477 4.5 1.253v13C19.832 18.477 18.246 18 16.5 18c-1.746 0-3.332.477-4.5 1.253" />
                                    </svg>
                                    Open Tutorial
                                </button>
                            )}
                        </div>
                        <div className="flex gap-2">
                            <button
                                onClick={onClose}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-300"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSave}
                                disabled={saving}
                                 className={`px-4 py-2 ${theme.colors.accent.cyan.dark} hover:${theme.colors.accent.cyan.DEFAULT} text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {saving ? (
                                    <span className="text-button text-white/80">Saving...</span>
                                ) : (
                                    'Save'
                                )}
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
        </>
    )
}
