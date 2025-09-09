import { useState, useEffect, useCallback, ReactElement } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import { useFontSize } from '../../contexts/FontSizeContext'
import { useSettings, AgentType } from '../../hooks/useSettings'
import { useActionButtons } from '../../contexts/ActionButtonsContext'
import type { HeaderActionConfig } from '../ActionButton'
import { AnimatedText } from '../common/AnimatedText'
import { SpecContentModal } from '../SpecContentModal'
import { MCPConfigPanel } from '../settings/MCPConfigPanel'
import { logger } from '../../utils/logger'
import { analytics } from '../../analytics'

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

type SettingsCategory = 'appearance' | 'keyboard' | 'environment' | 'projects' | 'run-scripts' | 'terminal' | 'sessions' | 'archives' | 'actions' | 'privacy' | 'version'

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
        id: 'run-scripts',
        label: 'Run Scripts',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.828 14.828a4 4 0 01-5.656 0M9 10h1m4 0h1m-7 4h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2z" />
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
        id: 'privacy',
        label: 'Privacy',
        icon: (
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
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
}

interface SessionPreferences {
    auto_commit_on_review: boolean
    skip_confirmation_modals: boolean
}

export function SettingsModal({ open, onClose, onOpenTutorial }: Props) {
    const { terminalFontSize, uiFontSize, setTerminalFontSize, setUiFontSize } = useFontSize()
    const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance')
    const [activeAgentTab, setActiveAgentTab] = useState<AgentType>('claude')
    const [projectPath, setProjectPath] = useState<string>('')
    const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
        setupScript: '',
        environmentVariables: []
    })
    const [terminalSettings, setTerminalSettings] = useState<TerminalSettings>({
        shell: null,
        shellArgs: []
    })
    const [sessionPreferences, setSessionPreferences] = useState<SessionPreferences>({
        auto_commit_on_review: false,
        skip_confirmation_modals: false
    })
    const [runScript, setRunScript] = useState<RunScript>({
        command: '',
        workingDirectory: '',
        environmentVariables: {}
    })
    const [envVars, setEnvVars] = useState<Record<AgentType, Array<{key: string, value: string}>>>({
        claude: [],
        'cursor-agent': [],
        opencode: [],
        gemini: [],
        qwen: [],
        codex: []
    })
    const [cliArgs, setCliArgs] = useState<Record<AgentType, string>>({
        claude: '',
        'cursor-agent': '',
        opencode: '',
        gemini: '',
        qwen: '',
        codex: ''
    })
    const [binaryConfigs, setBinaryConfigs] = useState<Record<AgentType, AgentBinaryConfig>>({
        claude: { agent_name: 'claude', custom_path: null, auto_detect: true, detected_binaries: [] },
        'cursor-agent': { agent_name: 'cursor-agent', custom_path: null, auto_detect: true, detected_binaries: [] },
        opencode: { agent_name: 'opencode', custom_path: null, auto_detect: true, detected_binaries: [] },
        gemini: { agent_name: 'gemini', custom_path: null, auto_detect: true, detected_binaries: [] },
        qwen: { agent_name: 'qwen', custom_path: null, auto_detect: true, detected_binaries: [] },
        codex: { agent_name: 'codex', custom_path: null, auto_detect: true, detected_binaries: [] }
    })
    const [notification, setNotification] = useState<NotificationState>({
        message: '',
        type: 'info',
        visible: false
    })
    const [appVersion, setAppVersion] = useState<string>('')
    const [analyticsConsent, setAnalyticsConsent] = useState<boolean>(false)

    // Archived specs state
    type ArchivedSpec = {
        id: string
        session_name: string
        repository_path: string
        repository_name: string
        content: string
        archived_at: number | string
    }
    const [archives, setArchives] = useState<ArchivedSpec[]>([])
    const [archivesLoading, setArchivesLoading] = useState(false)
    const [archiveMax, setArchiveMax] = useState<number>(50)
    const [selectedSpec, setSelectedSpec] = useState<{ name: string; content: string } | null>(null)
    
    const {
        loading,
        saving,
        saveAllSettings,
        loadEnvVars,
        loadCliArgs,
        loadProjectSettings,
        loadTerminalSettings,
        loadSessionPreferences
    } = useSettings()
    
    const {
        actionButtons,
        saveActionButtons,
        resetToDefaults
    } = useActionButtons()
    
    const [editableActionButtons, setEditableActionButtons] = useState<HeaderActionConfig[]>([])
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false)
    
    const showNotification = (message: string, type: NotificationType) => {
        setNotification({ message, type, visible: true })
        setTimeout(() => {
            setNotification(prev => ({ ...prev, visible: false }))
        }, 3000)
    }

    // Normalize smart dashes some platforms insert automatically (Safari/macOS)
    // so CLI flags like "--model" are preserved as two ASCII hyphens.
    const loadRunScript = useCallback(async (): Promise<RunScript> => {
        try {
            const result = await invoke<RunScript | null>('get_project_run_script')
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
    
    const normalizeCliText = (text: string): string => {
        return text
            .replace(/—/g, '--') // em dash → double hyphen
            .replace(/–/g, '--') // en dash → double hyphen
            .replace(/−/g, '-')  // minus sign → hyphen
    }

    // Prevent smart punctuation from altering input by intercepting beforeinput
    // and paste events. Applies normalization and attempts to preserve caret.
    const handleBeforeInputNormalize = (
        e: React.FormEvent<HTMLInputElement | HTMLTextAreaElement>,
        currentValue: string,
        applyValue: (value: string) => void,
    ) => {
        // @ts-expect-error: React typings don't expose .data on nativeEvent
        const data: string | null | undefined = e.nativeEvent?.data
        if (!data) return
        if (!/[—–−]/.test(data)) return

        const target = e.currentTarget as HTMLInputElement
        const selectionStart = target.selectionStart ?? currentValue.length
        const selectionEnd = target.selectionEnd ?? selectionStart
        const replacement = normalizeCliText(data)

        e.preventDefault()
        const next =
            currentValue.slice(0, selectionStart) +
            replacement +
            currentValue.slice(selectionEnd)
        const newCaret = selectionStart + replacement.length
        applyValue(next)
        requestAnimationFrame(() => {
            try { target.setSelectionRange(newCaret, newCaret) } catch {
                // Selection range failed, ignore
            }
        })
    }

    const handlePasteNormalize = (
        e: React.ClipboardEvent<HTMLInputElement | HTMLTextAreaElement>,
        currentValue: string,
        applyValue: (value: string) => void,
    ) => {
        const pasted = e.clipboardData.getData('text')
        if (!/[—–−]/.test(pasted)) return
        const target = e.currentTarget as HTMLInputElement
        const selectionStart = target.selectionStart ?? currentValue.length
        const selectionEnd = target.selectionEnd ?? selectionStart
        const replacement = normalizeCliText(pasted)

        e.preventDefault()
        const next =
            currentValue.slice(0, selectionStart) +
            replacement +
            currentValue.slice(selectionEnd)
        const newCaret = selectionStart + replacement.length
        applyValue(next)
        requestAnimationFrame(() => {
            try { target.setSelectionRange(newCaret, newCaret) } catch {
                // Selection range failed, ignore
            }
        })
    }


    // Load archives when the category is opened
    useEffect(() => {
        const load = async () => {
            if (activeCategory !== 'archives') return
            try {
                setArchivesLoading(true)
                const list = await invoke<ArchivedSpec[]>('schaltwerk_core_list_archived_specs')
                const max = await invoke<number>('schaltwerk_core_get_archive_max_entries')
                setArchives(list)
                setArchiveMax(max)
            } finally {
                setArchivesLoading(false)
            }
        }
        load()
    }, [activeCategory])

    // Load app version when the version category is opened
    useEffect(() => {
        const loadVersion = async () => {
            if (activeCategory !== 'version') return
            try {
                const version = await invoke<string>('get_app_version')
                setAppVersion(version)
            } catch (error) {
                logger.error('Failed to load app version:', error)
            }
        }
        loadVersion()
    }, [activeCategory])

    // Load analytics consent when the privacy category is opened
    useEffect(() => {
        const loadConsent = async () => {
            if (activeCategory !== 'privacy') return
            try {
                const consent = await invoke<boolean>('get_analytics_consent')
                setAnalyticsConsent(consent)
            } catch (error) {
                logger.error('Failed to load analytics consent:', error)
            }
        }
        loadConsent()
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
            const configs = await invoke<AgentBinaryConfig[]>('get_all_agent_binary_configs')
            logger.info('Received binary configurations:', configs)
            
            const configMap: Record<AgentType, AgentBinaryConfig> = {
                claude: { agent_name: 'claude', custom_path: null, auto_detect: true, detected_binaries: [] },
                'cursor-agent': { agent_name: 'cursor-agent', custom_path: null, auto_detect: true, detected_binaries: [] },
                opencode: { agent_name: 'opencode', custom_path: null, auto_detect: true, detected_binaries: [] },
                gemini: { agent_name: 'gemini', custom_path: null, auto_detect: true, detected_binaries: [] },
                qwen: { agent_name: 'qwen', custom_path: null, auto_detect: true, detected_binaries: [] },
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
        const [loadedEnvVars, loadedCliArgs, loadedSessionPreferences] = await Promise.all([
            loadEnvVars(),
            loadCliArgs(),
            loadSessionPreferences()
        ])
        
        // Load project-specific settings (may fail if no project is open)
        let loadedProjectSettings: ProjectSettings = { setupScript: '', environmentVariables: [] }
        let loadedTerminalSettings: TerminalSettings = { shell: null, shellArgs: [] }
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
        
        loadBinaryConfigs()
    }, [loadEnvVars, loadCliArgs, loadSessionPreferences, loadProjectSettings, loadTerminalSettings, loadRunScript, loadBinaryConfigs])

    useEffect(() => {
        if (open) {
            loadAllSettings()
            // Also load the project path for MCP settings
            invoke<string | null>('get_active_project_path').then(path => {
                if (path) setProjectPath(path)
            })
        }
    }, [open, loadAllSettings])

    const handleBinaryPathChange = async (agent: AgentType, path: string | null) => {
        try {
            await invoke('set_agent_binary_path', { 
                agentName: agent, 
                path: path || null 
            })
            
            const updatedConfig = await invoke<AgentBinaryConfig>('get_agent_binary_config', { agentName: agent })
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
            const updatedConfig = await invoke<AgentBinaryConfig>('refresh_agent_binary_detection', { agentName: agent })
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

    const handleSave = async () => {
        const result = await saveAllSettings(envVars, cliArgs, projectSettings, terminalSettings, sessionPreferences)
        
        // Save run script
        try {
            await invoke('set_project_run_script', { runScript })
            result.savedSettings.push('run script')
        } catch (error) {
            logger.info('Run script not saved - requires active project', error)
        }
        
        // Save action buttons if they've been modified
        if (hasUnsavedChanges) {
            const success = await saveActionButtons(editableActionButtons)
            if (!success) {
                result.failedSettings.push('action buttons')
            }
            // No need to reload - saveActionButtons updates the context state directly
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
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-sm font-medium text-slate-200 mb-2">Archived Specs</h3>
                        <div className="text-sm text-slate-400 mb-4">Recover deleted prompts back to specs.</div>
                        <div className="mb-4 flex items-center gap-3">
                            <label className="text-sm text-slate-300">Max entries</label>
                            <input
                                type="number"
                                value={archiveMax}
                                onChange={(e) => setArchiveMax(parseInt(e.target.value || '0') || 0)}
                                className="w-24 bg-slate-900 border border-slate-700 rounded px-2 py-1 text-slate-200"
                            />
                            <button onClick={async () => {
                                try {
                                    await invoke('schaltwerk_core_set_archive_max_entries', { limit: archiveMax })
                                    showNotification('Archive limit saved', 'success')
                                } catch (e) {
                                    logger.error('Failed to save archive limit', e)
                                    showNotification('Failed to save archive limit', 'error')
                                }
                            }} className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-slate-200 text-sm">Save</button>
                        </div>
                        {archivesLoading ? (
                            <div className="py-6"><AnimatedText text="loading" size="sm" /></div>
                        ) : archives.length === 0 ? (
                            <div className="text-slate-400 text-sm">No archived specs.</div>
                        ) : (
                            <div className="space-y-3 w-full">
                                {archives.map(item => (
                                    <div key={item.id} className="w-full border border-slate-800 rounded p-3 bg-slate-900/40 flex items-start justify-between gap-3 min-w-0">
                                        <div 
                                            className="flex-1 min-w-0 overflow-hidden pr-2 cursor-pointer hover:opacity-80 transition-opacity" 
                                            style={{maxWidth: 'calc(100% - 140px)'}}
                                            onClick={() => setSelectedSpec({ name: item.session_name, content: item.content })}
                                        >
                                            <div className="text-slate-200 text-sm truncate">{item.session_name}</div>
                                             <div className="text-xs text-slate-500">{
                                               (() => {
                                                 const v = item.archived_at as string | number
                                                 let ts: number
                                                 if (typeof v === 'number') {
                                                   ts = v > 1e12 ? v : v * 1000
                                                 } else {
                                                   const parsed = Date.parse(v)
                                                   ts = isNaN(parsed) ? Date.now() : parsed
                                                 }
                                                 return new Date(ts).toLocaleString()
                                               })()
                                             }</div>
                                            <div className="text-xs text-slate-500 line-clamp-2 mt-1 break-all overflow-hidden max-w-full">{item.content}</div>
                                        </div>
                                        <div className="flex items-center gap-2 flex-shrink-0">
                                            <button onClick={async () => {
                                                try {
                                                    await invoke('schaltwerk_core_restore_archived_spec', { id: item.id, newName: null })
                                                    const list = await invoke<ArchivedSpec[]>('schaltwerk_core_list_archived_specs')
                                                    setArchives(list)
                                                    showNotification('Restored to specs', 'success')
                                                } catch (e) {
                                                    logger.error('Failed to restore archived spec', e)
                                                    showNotification('Failed to restore', 'error')
                                                }
                                            }} className="px-2 py-1 border border-slate-700 rounded text-slate-200 text-xs bg-slate-800 hover:bg-slate-700">Restore</button>
                                            <button onClick={async () => {
                                                try {
                                                    await invoke('schaltwerk_core_delete_archived_spec', { id: item.id })
                                                    const list = await invoke<ArchivedSpec[]>('schaltwerk_core_list_archived_specs')
                                                    setArchives(list)
                                                } catch (e) {
                                                    logger.error('Failed to delete archived spec', e)
                                                    showNotification('Failed to delete', 'error')
                                                }
                                            }} className="px-2 py-1 border border-red-700 rounded text-red-200 text-xs bg-red-900/30 hover:bg-red-900/50">Delete</button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
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
                    {(['claude', 'cursor-agent', 'opencode', 'gemini', 'qwen', 'codex'] as AgentType[]).map(agent => (
                        <button
                            key={agent}
                            onClick={() => setActiveAgentTab(agent)}
                            className={`px-6 py-3 text-sm font-medium transition-colors capitalize ${
                                activeAgentTab === agent
                                    ? 'text-slate-200 border-b-2 border-blue-500'
                                    : 'text-slate-400 hover:text-slate-300'
                            }`}
                        >
                            {agent === 'opencode' ? 'OpenCode' : agent === 'codex' ? 'Codex' : agent === 'cursor-agent' ? 'Cursor' : agent}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    {/* Claude MCP Configuration */}
                    {activeAgentTab === 'claude' && projectPath && (
                        <div>
                            <MCPConfigPanel projectPath={projectPath} />
                        </div>
                    )}

                    {/* Binary Path Configuration */}
                    <div>
                        <h3 className="text-sm font-medium text-slate-200 mb-2">Binary Path</h3>
                        <div className="text-sm text-slate-400 mb-4">
                            Configure which {activeAgentTab === 'cursor-agent' ? 'cursor-agent' : activeAgentTab} binary to use. 
                            Auto-detection finds all installed versions and recommends the best one.
                            <span className="block mt-2 text-xs text-slate-500">
                                Note: Agent binary configurations are stored globally and apply to all projects.
                            </span>
                        </div>

                        {/* Current Configuration */}
                        <div className="mb-4 p-3 bg-slate-800 rounded border border-slate-700">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-xs text-slate-400">Current Binary</span>
                                <button
                                    onClick={() => handleRefreshBinaryDetection(activeAgentTab)}
                                    className="text-xs text-blue-400 hover:text-blue-300 transition-colors"
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
                                    <div className="font-mono text-sm text-green-400">
                                        {binaryConfigs[activeAgentTab].custom_path}
                                    </div>
                                    <div className="text-xs text-slate-500">Custom path (user configured)</div>
                                    <button
                                        onClick={() => handleBinaryPathChange(activeAgentTab, null)}
                                        className="text-xs text-orange-400 hover:text-orange-300 transition-colors"
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
                                                <div className="font-mono text-sm text-slate-200">
                                                    {recommended.path}
                                                </div>
                                                <div className="flex items-center gap-2 text-xs">
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
                                            <div className="text-sm text-slate-400">
                                                {binaryConfigs[activeAgentTab].detected_binaries[0].path}
                                            </div>
                                        )
                                    })()}
                                </div>
                            ) : (
                                <div className="text-sm text-yellow-400">
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
                                    placeholder={binaryConfigs[activeAgentTab].detected_binaries.find(b => b.is_recommended)?.path || `Path to ${activeAgentTab} binary`}
                                    className="flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-sm"
                                />
                                <button
                                    onClick={() => openFilePicker(activeAgentTab)}
                                    className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-slate-200 rounded border border-slate-600 text-sm transition-colors"
                                    title="Browse for binary"
                                >
                                    Browse
                                </button>
                            </div>

                            {/* Detected Binaries List */}
                            {binaryConfigs[activeAgentTab].detected_binaries.length > 0 && (
                                <div className="mt-4">
                                    <h4 className="text-xs font-medium text-slate-300 mb-2">Detected Binaries</h4>
                                    <div className="space-y-1 max-h-32 overflow-y-auto">
                                        {binaryConfigs[activeAgentTab].detected_binaries.map((binary, index) => (
                                            <div
                                                key={index}
                                                className="flex items-center justify-between p-2 bg-slate-800 rounded border border-slate-700 hover:border-slate-600 transition-colors cursor-pointer"
                                                onClick={() => handleBinaryPathChange(activeAgentTab, binary.path)}
                                            >
                                                <div className="flex-1 min-w-0">
                                                    <div className="font-mono text-xs text-slate-200 truncate">
                                                        {binary.path}
                                                    </div>
                                                    <div className="flex items-center gap-2 text-xs mt-1">
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
                                                                <span className="text-blue-400">→ {binary.symlink_target}</span>
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
                        <h3 className="text-sm font-medium text-slate-200 mb-2">CLI Arguments</h3>
                        <div className="text-sm text-slate-400 mb-3">
                            Add custom command-line arguments that will be appended to the {activeAgentTab === 'cursor-agent' ? 'cursor-agent' : activeAgentTab === 'opencode' ? 'OpenCode' : activeAgentTab === 'codex' ? 'Codex' : activeAgentTab} command.
                        </div>
                        <input
                            type="text"
                            value={cliArgs[activeAgentTab]}
                            onChange={(e) => setCliArgs(prev => ({ ...prev, [activeAgentTab]: normalizeCliText(e.target.value) }))}
                            onBeforeInput={(e) =>
                                handleBeforeInputNormalize(
                                    e,
                                    cliArgs[activeAgentTab],
                                    (val) => setCliArgs(prev => ({ ...prev, [activeAgentTab]: val })),
                                )
                            }
                            onPaste={(e) =>
                                handlePasteNormalize(
                                    e,
                                    cliArgs[activeAgentTab],
                                    (val) => setCliArgs(prev => ({ ...prev, [activeAgentTab]: val })),
                                )
                            }
                            placeholder="e.g., --profile test or -p some 'quoted value'"
                            className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-sm"
                            autoCorrect="off"
                            autoCapitalize="off"
                            autoComplete="off"
                            spellCheck={false}
                            inputMode="text"
                            style={{ fontVariantLigatures: 'none' }}
                        />
                        <div className="mt-2 text-xs text-slate-500">
                            Examples: <code className="text-blue-400">--profile test</code>, <code className="text-blue-400">-d</code>, <code className="text-blue-400">--model gpt-4</code>
                        </div>
                    </div>

                    <div className="border-t border-slate-700 pt-6">
                        <h3 className="text-sm font-medium text-slate-200 mb-2">Environment Variables</h3>
                        <div className="text-sm text-slate-400 mb-4">
                            Configure environment variables for {activeAgentTab === 'cursor-agent' ? 'Cursor' : activeAgentTab === 'opencode' ? 'OpenCode' : activeAgentTab === 'codex' ? 'Codex' : activeAgentTab} agent. 
                            These variables will be available when starting agents with this agent type.
                        </div>

                        <div className="space-y-3">
                            {envVars[activeAgentTab].map((item, index) => (
                                <div key={index} className="flex gap-2">
                                    <input
                                        type="text"
                                        value={item.key}
                                        onChange={(e) => handleEnvVarChange(activeAgentTab, index, 'key', normalizeCliText(e.target.value))}
                                        onBeforeInput={(e) =>
                                            handleBeforeInputNormalize(
                                                e,
                                                item.key,
                                                (val) => handleEnvVarChange(activeAgentTab, index, 'key', val),
                                            )
                                        }
                                        onPaste={(e) =>
                                            handlePasteNormalize(
                                                e,
                                                item.key,
                                                (val) => handleEnvVarChange(activeAgentTab, index, 'key', val),
                                            )
                                        }
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
                                        onChange={(e) => handleEnvVarChange(activeAgentTab, index, 'value', normalizeCliText(e.target.value))}
                                        onBeforeInput={(e) =>
                                            handleBeforeInputNormalize(
                                                e,
                                                item.value,
                                                (val) => handleEnvVarChange(activeAgentTab, index, 'value', val),
                                            )
                                        }
                                        onPaste={(e) =>
                                            handlePasteNormalize(
                                                e,
                                                item.value,
                                                (val) => handleEnvVarChange(activeAgentTab, index, 'value', val),
                                            )
                                        }
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
                            <div className="text-xs text-slate-400">
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

                    {activeAgentTab === 'cursor-agent' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
                                <strong>Common Cursor CLI arguments:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><code>--model gpt-4</code> - Specify model preference</li>
                                    <li><code>--max-tokens 4000</code> - Set token limit</li>
                                </ul>
                                <strong className="block mt-3">Common environment variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>CURSOR_API_KEY - Your Cursor API key</li>
                                    <li>CURSOR_MODEL - Model preference</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeAgentTab === 'opencode' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
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
                            <div className="text-xs text-slate-400">
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

                    {activeAgentTab === 'qwen' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
                                <strong>Common Qwen Code CLI arguments:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><code>--prompt "task description"</code> - Start with specific prompt</li>
                                    <li><code>--temperature 0.9</code> - Set response temperature</li>
                                    <li><code>--yolo</code> - Skip permission prompts (if supported)</li>
                                </ul>
                                <strong className="block mt-3">Common environment variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>QWEN_API_KEY - Your Qwen API key</li>
                                    <li>OPENAI_API_KEY - OpenAI-compatible API key</li>
                                    <li>QWEN_MODEL - Model to use (defaults to Qwen-Coder)</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeAgentTab === 'codex' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
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
                        <h3 className="text-sm font-medium text-slate-200 mb-2">Worktree Setup Script</h3>
                        <div className="text-sm text-slate-400 mb-4">
                            Configure a script that runs automatically when a new worktree is created for this project.
                            The script will be executed in the new worktree directory.
                        </div>
                        
                        <div className="mb-4 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400 mb-2">
                                <strong>Available variables:</strong>
                            </div>
                            <ul className="text-xs text-slate-500 space-y-1 list-disc list-inside">
                                <li><code className="text-blue-400">$WORKTREE_PATH</code> - Path to the new worktree</li>
                                <li><code className="text-blue-400">$REPO_PATH</code> - Path to the main repository</li>
                                <li><code className="text-blue-400">$SESSION_NAME</code> - Name of the agent</li>
                                <li><code className="text-blue-400">$BRANCH_NAME</code> - Name of the new branch</li>
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
                                className="w-full h-48 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-sm resize-none overflow-auto focus:outline-none focus:border-blue-500 transition-colors scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800"
                                spellCheck={false}
                                style={{ 
                                    scrollbarWidth: 'thin',
                                    scrollbarColor: '#475569 #1e293b'
                                }}
                            />
                        </div>
                        
                        <div className="mt-4 p-3 bg-blue-900/20 border border-blue-800/50 rounded">
                            <div className="text-xs text-blue-300 mb-2">
                                <strong>Example use cases:</strong>
                            </div>
                            <ul className="text-xs text-slate-400 space-y-1 list-disc list-inside">
                                <li>Copy environment files (.env, .env.local)</li>
                                <li>Install dependencies (npm install, pip install)</li>
                                <li>Set up database connections</li>
                                <li>Configure IDE settings</li>
                                <li>Create required directories</li>
                            </ul>
                        </div>
                    </div>
                    
                    <div className="mt-8">
                        <h3 className="text-sm font-medium text-slate-200 mb-2">Project Environment Variables</h3>
                        <div className="text-sm text-slate-400 mb-4">
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
                                        className="flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
                                    />
                                    <input
                                        type="text"
                                        value={envVar.value}
                                        onChange={(e) => handleProjectEnvVarChange(index, 'value', e.target.value)}
                                        placeholder="value"
                                        className="flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 focus:outline-none focus:border-blue-500 transition-colors"
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
                            <div className="text-xs text-slate-400">
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
                        <h3 className="text-sm font-medium text-slate-200 mb-4">Font Sizes</h3>
                        <div className="space-y-4">
                            <div>
                                <label className="flex items-center justify-between mb-2">
                                    <span className="text-sm text-slate-300">Terminal Font Size</span>
                                    <span className="text-sm text-slate-400">{terminalFontSize}px</span>
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
                                            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((terminalFontSize - 8) / 16) * 100}%, #475569 ${((terminalFontSize - 8) / 16) * 100}%, #475569 100%)`
                                        }}
                                    />
                                    <button
                                        onClick={() => setTerminalFontSize(13)}
                                        className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-400"
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                            
                            <div>
                                <label className="flex items-center justify-between mb-2">
                                    <span className="text-sm text-slate-300">UI Font Size</span>
                                    <span className="text-sm text-slate-400">{uiFontSize}px</span>
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
                                            background: `linear-gradient(to right, #3b82f6 0%, #3b82f6 ${((uiFontSize - 8) / 16) * 100}%, #475569 ${((uiFontSize - 8) / 16) * 100}%, #475569 100%)`
                                        }}
                                    />
                                    <button
                                        onClick={() => setUiFontSize(12)}
                                        className="px-3 py-1 text-xs bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded transition-colors text-slate-400"
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                        </div>
                        
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
                                <strong>Keyboard shortcuts:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">Cmd/Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">+</kbd> Increase both font sizes</li>
                                    <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">Cmd/Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">-</kbd> Decrease both font sizes</li>
                                    <li><kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">Cmd/Ctrl</kbd> + <kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">0</kbd> Reset both font sizes</li>
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
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-sm font-medium text-slate-200 mb-4">Navigation</h3>
                        <div className="bg-slate-800/50 border border-slate-700 rounded p-4">
                            <ul className="space-y-2 text-sm">
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Switch to Orchestrator</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + 1</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Switch to Session 1-8</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + 2-9</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Previous Session</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + ↑</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Next Session</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + ↓</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Switch to Previous Project</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + ←</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Switch to Next Project</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + →</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Focus Claude Session</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + T</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Focus Terminal</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + /</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">New Line in Terminal (when terminal focused)</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + Enter</kbd>
                                </li>
                            </ul>
                        </div>
                    </div>
                    
                    <div>
                        <h3 className="text-sm font-medium text-slate-200 mb-4">Session Management</h3>
                        <div className="bg-slate-800/50 border border-slate-700 rounded p-4">
                            <ul className="space-y-2 text-sm">
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">New Session</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + N</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">New Spec</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + Shift + N</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Cancel Session</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + D</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Force Cancel Session</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + Shift + D</kbd>
                                </li>
                                 <li className="flex justify-between items-center">
                                     <span className="text-slate-300">Mark Ready for Review</span>
                                     <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + R</kbd>
                                 </li>
                                 <li className="flex justify-between items-center">
                                     <span className="text-slate-300">Promote Best Version (in group)</span>
                                     <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + B</kbd>
                                 </li>
                                 <li className="flex justify-between items-center">
                                     <span className="text-slate-300">Convert Session to Spec</span>
                                     <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + S</kbd>
                                 </li>
                                 <li className="flex justify-between items-center">
                                     <span className="text-slate-300">Open Diff Viewer (Session/Orchestrator)</span>
                                     <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + G</kbd>
                                 </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Open Agent Board (Kanban)</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + Shift + K</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Enter Spec Mode (Orchestrator)</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + Shift + S</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Finish Review (in diff viewer)</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + Enter</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Add Comment (hover over diff line)</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Enter</kbd>
                                </li>
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Run Spec Agent (when focused)</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">Cmd/Ctrl + Enter</kbd>
                                </li>
                            </ul>
                        </div>
                    </div>
                    
                    <div>
                        <h3 className="text-sm font-medium text-slate-200 mb-4">Action Buttons</h3>
                        <div className="bg-slate-800/50 border border-slate-700 rounded p-4">
                            <p className="text-sm text-slate-300 mb-3">
                                Action buttons appear in the terminal header and provide quick access to common AI prompts.
                            </p>
                            <ul className="space-y-2 text-sm">
                                <li className="flex justify-between items-center">
                                    <span className="text-slate-300">Action Button 1-6</span>
                                    <kbd className="px-2 py-1 bg-slate-700 rounded text-xs">F1-F6</kbd>
                                </li>
                            </ul>
                            <div className="mt-3 pt-3 border-t border-slate-600 text-xs text-slate-400">
                                <p className="mb-2">💡 Tip: Configure your action buttons in the "Action Buttons" settings tab.</p>
                                <p>You can customize up to 6 buttons with different colors and AI prompts that will be pasted into Claude.</p>
                            </div>
                        </div>
                    </div>
                    
                    <div className="p-4 bg-slate-800/30 border border-slate-700 rounded">
                        <div className="text-xs text-slate-400">
                            <p className="mb-2">Note: Use <kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">Ctrl</kbd> instead of <kbd className="px-1 py-0.5 bg-slate-700 rounded text-xs">Cmd</kbd> on Windows/Linux systems.</p>
                            <p>Keyboard shortcuts work globally throughout the application and can be used to efficiently navigate between agents and manage your workflow.</p>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )

    const renderTerminalSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-sm font-medium text-slate-200 mb-4">Terminal Shell Configuration</h3>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-slate-300 mb-2">Shell Path</label>
                                <input
                                    type="text"
                                    value={terminalSettings.shell || ''}
                                    onChange={(e) => setTerminalSettings({ ...terminalSettings, shell: e.target.value || null })}
                                    placeholder="Leave empty to use system default ($SHELL)"
                                    className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-sm"
                                />
                                <div className="mt-2 text-xs text-slate-500">
                                    Examples: <code className="text-blue-400">/usr/local/bin/nu</code>, <code className="text-blue-400">/opt/homebrew/bin/fish</code>, <code className="text-blue-400">/bin/zsh</code>
                                </div>
                            </div>
                            
                            <div>
                                <label className="block text-sm text-slate-300 mb-2">Shell Arguments</label>
                                <input
                                    type="text"
                                    value={(terminalSettings.shellArgs || []).join(' ')}
                                    onChange={(e) => {
                                        const args = e.target.value.trim() ? e.target.value.split(' ') : []
                                        setTerminalSettings({ ...terminalSettings, shellArgs: args })
                                    }}
                                    placeholder="Default: -i (interactive mode)"
                                    className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-sm"
                                />
                                <div className="mt-2 text-xs text-slate-500">
                                    Space-separated arguments passed to the shell. Leave empty for default interactive mode.
                                </div>
                            </div>
                        </div>
                        
                        <div className="mt-6 p-4 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
                                <strong className="text-slate-300">Popular Shell Configurations:</strong>
                                <ul className="mt-3 space-y-2">
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-400">Nushell:</span>
                                        <div>
                                            <div>Path: <code>/usr/local/bin/nu</code> or <code>/opt/homebrew/bin/nu</code></div>
                                            <div>Args: (leave empty, Nushell doesn't need -i)</div>
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-400">Fish:</span>
                                        <div>
                                            <div>Path: <code>/usr/local/bin/fish</code> or <code>/opt/homebrew/bin/fish</code></div>
                                            <div>Args: <code>-i</code></div>
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-400">Zsh:</span>
                                        <div>
                                            <div>Path: <code>/bin/zsh</code> or <code>/usr/bin/zsh</code></div>
                                            <div>Args: <code>-i</code></div>
                                        </div>
                                    </li>
                                    <li className="flex items-start gap-2">
                                        <span className="text-blue-400">Bash:</span>
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
                        <h3 className="text-sm font-medium text-slate-200 mb-4">Action Buttons</h3>
                        <p className="text-sm text-slate-400 mb-4">
                            Configure custom action buttons that appear in the terminal header for both orchestrator and agent views.
                            These buttons provide quick access to common AI prompts that will be pasted directly into Claude.
                        </p>
                        
                        <div className="bg-blue-900/20 border border-blue-700/50 rounded p-3 mb-6">
                            <div className="text-xs text-blue-300">
                                <strong>💡 How it works:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside text-blue-200">
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
                                            <label className="block text-sm text-slate-300 mb-2">Label</label>
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
                                            <label className="block text-sm text-slate-300 mb-2">Color</label>
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
                                        <label className="block text-sm text-slate-300 mb-2">AI Prompt</label>
                                        <textarea
                                            value={button.prompt}
                                            onChange={(e) => {
                                                const updated = [...editableActionButtons]
                                                updated[index] = { ...button, prompt: e.target.value }
                                                setEditableActionButtons(updated)
                                                setHasUnsavedChanges(true)
                                            }}
                                            className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 font-mono text-sm min-h-[80px] resize-y"
                                            placeholder="Enter the AI prompt that will be pasted into Claude chat..."
                                        />
                                    </div>
                                    <div className="mt-4 flex justify-end">
                                        <button
                                            onClick={() => {
                                                setEditableActionButtons(editableActionButtons.filter((_, i) => i !== index))
                                                setHasUnsavedChanges(true)
                                            }}
                                            className="text-red-400 hover:text-red-300 text-sm flex items-center gap-1"
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
                        className="text-slate-400 hover:text-slate-300 text-sm"
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
                        <h3 className="text-sm font-medium text-slate-200 mb-2">Session Review Settings</h3>
                        <div className="text-sm text-slate-400 mb-4">
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
                                    className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                                />
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-slate-200">
                                        Auto-commit on Review
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">
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
                                    className="w-4 h-4 text-blue-600 bg-slate-800 border-slate-600 rounded focus:ring-blue-500 focus:ring-2"
                                />
                                <div className="flex-1">
                                    <div className="text-sm font-medium text-slate-200">
                                        Skip Confirmation Dialogs
                                    </div>
                                    <div className="text-xs text-slate-400 mt-1">
                                        Skip confirmation dialogs for actions that ask "Don't ask me again".
                                        When enabled, previously dismissed confirmations will be automatically applied.
                                    </div>
                                </div>
                            </label>
                        </div>
                        
                        <div className="mt-4 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
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

    const renderPrivacySettings = () => {
        const handleToggleAnalytics = async (enabled: boolean) => {
            try {
                await invoke('set_analytics_consent', { consent: enabled })
                await analytics.updateConsent(enabled)
                setAnalyticsConsent(enabled)
                showNotification(
                    enabled ? 'Analytics enabled' : 'Analytics disabled',
                    'success'
                )
            } catch (error) {
                logger.error('Failed to update analytics consent:', error)
                showNotification('Failed to update analytics settings', 'error')
            }
        }

        return (
            <div className="flex flex-col h-full">
                <div className="flex-1 overflow-y-auto p-6">
                    <div className="space-y-6">
                        <div>
                            <h3 className="text-sm font-medium text-slate-200 mb-4">Privacy Settings</h3>
                            <div className="space-y-4">
                                <div className="flex items-center justify-between py-3 px-4 bg-slate-800/50 rounded-lg">
                                    <div className="flex flex-col flex-1 mr-4">
                                        <span className="text-sm font-medium text-slate-200">Anonymous Analytics</span>
                                        <span className="text-xs text-slate-400 mt-1">
                                            Help improve Schaltwerk by sharing anonymous usage metrics.
                                            All data is completely anonymous and GDPR compliant.
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => handleToggleAnalytics(!analyticsConsent)}
                                        className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                                            analyticsConsent ? 'bg-blue-600' : 'bg-slate-600'
                                        }`}
                                    >
                                        <span
                                            className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
                                                analyticsConsent ? 'translate-x-6' : 'translate-x-1'
                                            }`}
                                        />
                                    </button>
                                </div>
                                
                                <div className="mt-4 p-4 bg-slate-800/30 rounded-lg">
                                    <h4 className="text-xs font-medium text-slate-300 mb-2">Metrics we collect:</h4>
                                    <ul className="space-y-1 text-xs text-slate-400">
                                        <li>• <span className="text-slate-300">App started:</span> Version number only</li>
                                        <li>• <span className="text-slate-300">Sessions:</span> Agent type, duration, file count</li>
                                        <li>• <span className="text-slate-300">Specs:</span> Creation source (MCP/manual)</li>
                                        <li>• <span className="text-slate-300">Conversions:</span> Age in minutes when converted</li>
                                        <li>• <span className="text-slate-300">Features:</span> Feature name when used</li>
                                    </ul>
                                    
                                    <h4 className="text-xs font-medium text-slate-300 mb-2 mt-4">What we NEVER collect:</h4>
                                    <ul className="space-y-1 text-xs text-slate-400">
                                        <li>• No file paths, project names, or repository URLs</li>
                                        <li>• No code content, terminal output, or commands</li>
                                        <li>• No git data, branch names, or commit messages</li>
                                        <li>• No error messages, stack traces, or logs</li>
                                        <li>• No IP addresses or device identifiers</li>
                                        <li>• No personal or identifiable information</li>
                                    </ul>
                                </div>
                                
                                <div className="mt-4 p-3 bg-blue-900/20 border border-blue-800/50 rounded-lg">
                                    <div className="flex items-start space-x-2">
                                        <svg className="w-4 h-4 text-blue-400 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                                        </svg>
                                        <div className="flex-1">
                                            <p className="text-xs text-slate-300">
                                                Data is processed by PostHog on EU servers and retained for 90 days.
                                                You can opt-out at any time and all future data collection will stop.
                                            </p>
                                            <button
                                                onClick={() => {
                                                    // Open privacy policy in browser
                                                    window.open('https://github.com/yourusername/schaltwerk/blob/main/PRIVACY.md', '_blank')
                                                }}
                                                className="mt-2 text-xs text-blue-400 hover:text-blue-300 underline transition-colors"
                                            >
                                                View full privacy policy →
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        )
    }

    const renderRunScriptsSettings = () => (
        <div className="flex flex-col h-full">
            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-6">
                    <div>
                        <h3 className="text-sm font-medium text-slate-200 mb-2">Run Script</h3>
                        <div className="text-sm text-slate-400 mb-4">Run tests or a development server to test changes in a workspace.</div>
                        
                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Command
                                </label>
                                <input
                                    type="text"
                                    value={runScript.command}
                                    onChange={(e) => setRunScript(prev => ({ ...prev, command: e.target.value }))}
                                    placeholder="just test"
                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                            </div>
                            
                            <div>
                                <label className="block text-sm font-medium text-slate-300 mb-2">
                                    Working Directory (Optional)
                                </label>
                                <input
                                    type="text"
                                    value={runScript.workingDirectory || ''}
                                    onChange={(e) => setRunScript(prev => ({ ...prev, workingDirectory: e.target.value || undefined }))}
                                    placeholder="Leave empty to use project root"
                                    className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded text-slate-200 text-sm font-mono focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
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
                        <h3 className="text-sm font-medium text-slate-200 mb-4">Application Information</h3>
                        <div className="space-y-4">
                            <div className="flex items-center justify-between py-3 px-4 bg-slate-800/50 rounded-lg">
                                <div className="flex flex-col">
                                    <span className="text-sm font-medium text-slate-200">Version</span>
                                    <span className="text-xs text-slate-400">Current application version</span>
                                </div>
                                <span className="text-sm font-mono text-slate-300 bg-slate-900/50 px-3 py-1 rounded">
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
            case 'run-scripts':
                return renderRunScriptsSettings()
            case 'terminal':
                return renderTerminalSettings()
            case 'sessions':
                return renderSessionSettings()
            case 'archives':
                return renderArchivesSettings()
            case 'actions':
                return renderActionButtonsSettings()
            case 'privacy':
                return renderPrivacySettings()
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
                    notification.type === 'success' ? 'bg-green-900' : 'bg-blue-900'
                }`}>
                    <div className="text-white text-sm">{notification.message}</div>
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
                        <AnimatedText text="loading" colorClassName="text-slate-500" size="md" />
                    </div>
                ) : (
                    <div className="flex-1 flex overflow-hidden">
                        {/* Sidebar */}
                        <div className="w-56 bg-slate-950/50 border-r border-slate-800 py-4">
                            <div className="px-3 mb-2">
                                <div className="text-xs font-medium text-slate-500 uppercase tracking-wider">Configuration</div>
                            </div>
                            <nav className="space-y-1 px-2">
                                {CATEGORIES.map(category => (
                                    <button
                                        key={category.id}
                                        onClick={() => setActiveCategory(category.id)}
                                        className={`w-full flex items-center gap-3 px-3 py-2 text-sm rounded-lg transition-colors ${
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
                                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
{saving ? (
                                    <AnimatedText text="loading" colorClassName="text-slate-500" size="xs" />
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
