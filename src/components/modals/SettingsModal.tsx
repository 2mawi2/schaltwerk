import { useState, useEffect, ReactElement } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { useFontSize } from '../../contexts/FontSizeContext'

interface Props {
    open: boolean
    onClose: () => void
}

type AgentType = 'claude' | 'cursor' | 'opencode'
type EnvVars = Record<string, string>
type SettingsCategory = 'appearance' | 'environment' | 'projects'

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
        id: 'environment',
        label: 'Environment Variables',
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
]

interface ProjectSettings {
    setupScript: string
}

export function SettingsModal({ open, onClose }: Props) {
    const { terminalFontSize, uiFontSize, setTerminalFontSize, setUiFontSize } = useFontSize()
    const [activeCategory, setActiveCategory] = useState<SettingsCategory>('appearance')
    const [activeAgentTab, setActiveAgentTab] = useState<AgentType>('claude')
    const [projectSettings, setProjectSettings] = useState<ProjectSettings>({
        setupScript: ''
    })
    const [envVars, setEnvVars] = useState<Record<AgentType, Array<{key: string, value: string}>>>({
        claude: [],
        cursor: [],
        opencode: []
    })
    const [loading, setLoading] = useState(false)
    const [saving, setSaving] = useState(false)

    useEffect(() => {
        if (open) {
            loadEnvVars()
            loadProjectSettings()
        }
    }, [open])

    const loadProjectSettings = async () => {
        try {
            const settings = await invoke<ProjectSettings>('get_project_settings')
            console.log('Loaded project settings:', settings)
            setProjectSettings(settings || { setupScript: '' })
        } catch (error) {
            console.error('Failed to load project settings:', error)
            setProjectSettings({ setupScript: '' })
        }
    }

    const loadEnvVars = async () => {
        setLoading(true)
        try {
            const agents: AgentType[] = ['claude', 'cursor', 'opencode']
            const loadedVars: Record<AgentType, Array<{key: string, value: string}>> = {
                claude: [],
                cursor: [],
                opencode: []
            }

            for (const agent of agents) {
                const vars = await invoke<EnvVars>('get_agent_env_vars', { agentType: agent })
                loadedVars[agent] = Object.entries(vars || {}).map(([key, value]) => ({ key, value }))
            }

            setEnvVars(loadedVars)
        } catch (error) {
            console.error('Failed to load environment variables:', error)
        } finally {
            setLoading(false)
        }
    }

    const handleSave = async () => {
        setSaving(true)
        try {
            // Save environment variables
            const agents: AgentType[] = ['claude', 'cursor', 'opencode']
            
            for (const agent of agents) {
                const vars: EnvVars = {}
                for (const item of envVars[agent]) {
                    if (item.key.trim()) {
                        vars[item.key.trim()] = item.value
                    }
                }
                await invoke('set_agent_env_vars', { agentType: agent, envVars: vars })
            }
            
            // Save project settings
            console.log('Saving project settings:', projectSettings)
            await invoke('set_project_settings', { settings: projectSettings })
            
            onClose()
        } catch (error) {
            console.error('Failed to save settings:', error)
        } finally {
            setSaving(false)
        }
    }

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
                    {(['claude', 'cursor', 'opencode'] as AgentType[]).map(agent => (
                        <button
                            key={agent}
                            onClick={() => setActiveAgentTab(agent)}
                            className={`px-6 py-3 text-sm font-medium transition-colors capitalize ${
                                activeAgentTab === agent
                                    ? 'text-slate-200 border-b-2 border-blue-500'
                                    : 'text-slate-400 hover:text-slate-300'
                            }`}
                        >
                            {agent === 'opencode' ? 'OpenCode' : agent}
                        </button>
                    ))}
                </div>
            </div>

            <div className="flex-1 overflow-y-auto p-6">
                <div className="space-y-4">
                    <div className="text-sm text-slate-400 mb-4">
                        Configure environment variables for {activeAgentTab === 'opencode' ? 'OpenCode' : activeAgentTab} agent. 
                        These variables will be available when starting sessions with this agent type.
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
                                />
                                <input
                                    type="text"
                                    value={item.value}
                                    onChange={(e) => handleEnvVarChange(activeAgentTab, index, 'value', e.target.value)}
                                    placeholder="Value"
                                    className="flex-1 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500"
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

                    {activeAgentTab === 'claude' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
                                <strong>Common Claude variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>ANTHROPIC_API_KEY - Your Anthropic API key</li>
                                    <li>CLAUDE_MODEL - Model to use (e.g., claude-3-opus-20240229)</li>
                                </ul>
                            </div>
                        </div>
                    )}

                    {activeAgentTab === 'cursor' && (
                        <div className="mt-6 p-3 bg-slate-800/50 border border-slate-700 rounded">
                            <div className="text-xs text-slate-400">
                                <strong>Common Cursor variables:</strong>
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
                                <strong>Common OpenCode variables:</strong>
                                <ul className="mt-2 space-y-1 list-disc list-inside">
                                    <li>OPENAI_API_KEY - Your OpenAI API key</li>
                                    <li>OPENCODE_MODEL - Model to use</li>
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
                                <li><code className="text-blue-400">$SESSION_NAME</code> - Name of the session</li>
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
                                className="w-full h-80 bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 placeholder-slate-500 font-mono text-sm resize-none overflow-auto focus:outline-none focus:border-blue-500 transition-colors scrollbar-thin scrollbar-thumb-slate-600 scrollbar-track-slate-800"
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

    const renderSettingsContent = () => {
        switch (activeCategory) {
            case 'appearance':
                return renderAppearanceSettings()
            case 'environment':
                return renderEnvironmentSettings()
            case 'projects':
                return renderProjectSettings()
            default:
                return renderAppearanceSettings()
        }
    }

    return (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-center justify-center">
            <div className="w-[900px] max-w-[95vw] h-[600px] max-h-[80vh] bg-slate-900 border border-slate-700 rounded-xl shadow-xl overflow-hidden flex flex-col">
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
                        <div className="text-slate-400">Loading settings...</div>
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
                        <div className="flex-1 flex flex-col">
                            {renderSettingsContent()}
                        </div>
                    </div>
                )}

                {/* Footer */}
                {!loading && (
                    <div className="px-4 py-3 border-t border-slate-800 flex justify-end gap-2">
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
                            {saving ? 'Saving...' : 'Save'}
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}