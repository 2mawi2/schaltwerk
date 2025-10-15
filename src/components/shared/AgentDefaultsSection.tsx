import { useMemo, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { theme } from '../../common/theme'
import { AgentType } from '../../types/session'
import { AgentEnvVar, displayNameForAgent } from './agentDefaults'

interface Props {
    agentType: AgentType
    cliArgs: string
    onCliArgsChange: (value: string) => void
    envVars: AgentEnvVar[]
    onEnvVarChange: (index: number, field: 'key' | 'value', value: string) => void
    onAddEnvVar: () => void
    onRemoveEnvVar: (index: number) => void
    loading?: boolean
}

export function AgentDefaultsSection({
    agentType,
    cliArgs,
    onCliArgsChange,
    envVars,
    onEnvVarChange,
    onAddEnvVar,
    onRemoveEnvVar,
    loading = false,
}: Props) {
    const agentDisplayName = displayNameForAgent(agentType)
    const [envEditorOpen, setEnvEditorOpen] = useState(false)
    const [advancedOpen, setAdvancedOpen] = useState(false)
    const cliArgsRef = useRef<HTMLTextAreaElement | null>(null)
    const buttonStyleVars = useMemo(() => ({
        '--agent-advanced-btn-bg': theme.colors.background.elevated,
        '--agent-advanced-btn-hover': theme.colors.background.hover,
        '--agent-advanced-btn-text': theme.colors.text.secondary,
        '--agent-advanced-btn-text-hover': theme.colors.text.primary,
        '--agent-advanced-btn-border': theme.colors.border.subtle,
    }) as CSSProperties, [])

    const buttonClasses = 'inline-flex items-center justify-center h-8 px-3 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[color:var(--agent-advanced-btn-bg)] text-[color:var(--agent-advanced-btn-text)] border-[color:var(--agent-advanced-btn-border)] hover:bg-[color:var(--agent-advanced-btn-hover)] hover:text-[color:var(--agent-advanced-btn-text-hover)] focus:outline-none focus:ring-1 focus:ring-[color:var(--agent-advanced-btn-border)] focus:ring-offset-0'

    const summaryText = useMemo(() => {
        if (loading) {
            return 'Loading agent defaults…'
        }

        if (envVars.length === 0) {
            return 'No environment variables configured yet.'
        }

        const summaryItems = envVars
            .slice(0, 3)
            .map(item => (item.key.trim() ? item.key.trim() : 'Unnamed'))
        const remaining = envVars.length - summaryItems.length

        return remaining > 0
            ? `${summaryItems.join(', ')} and ${remaining} more`
            : summaryItems.join(', ')
    }, [envVars, loading])

    const handleToggleEditor = () => {
        if (loading) {
            return
        }

        setEnvEditorOpen(prev => !prev)
    }

    const handleToggleAdvanced = () => {
        setAdvancedOpen(prev => {
            const next = !prev
            if (!next) {
                setEnvEditorOpen(false)
            } else {
                requestAnimationFrame(() => {
                    if (!loading) {
                        cliArgsRef.current?.focus({ preventScroll: true })
                    }
                })
            }
            return next
        })
    }

    const handleAddVariable = () => {
        if (loading) {
            return
        }

        if (!advancedOpen) {
            setAdvancedOpen(true)
        }

        if (!envEditorOpen) {
            setEnvEditorOpen(true)
        }

        onAddEnvVar()
    }

    return (
        <div className="space-y-3" data-testid="agent-defaults-section">
            <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                    <p className="text-sm text-slate-300">Advanced agent settings</p>
                    <p className="text-xs text-slate-400 mt-1">
                        {agentType === 'terminal'
                            ? `Configure environment variables for ${agentDisplayName}.`
                            : `Configure optional arguments and environment variables for ${agentDisplayName}.`
                        }
                    </p>
                </div>
                <button
                    type="button"
                    className={buttonClasses}
                    style={buttonStyleVars}
                    onClick={handleToggleAdvanced}
                    data-testid="advanced-agent-settings-toggle"
                    aria-expanded={advancedOpen}
                >
                    {advancedOpen ? 'Hide' : 'Show'} advanced
                </button>
            </div>

            {advancedOpen && (
                <div className="space-y-3">
                    {agentType !== 'terminal' && (
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">Default custom arguments</label>
                            <textarea
                                ref={cliArgsRef}
                                data-testid="agent-cli-args-input"
                                value={cliArgs}
                                onChange={event => onCliArgsChange(event.target.value)}
                                className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 font-mono text-sm"
                                placeholder="e.g. --max-tokens 8000 --sampling-temp 0.2"
                                rows={2}
                                disabled={loading}
                            />
                            <p className="text-xs text-slate-400 mt-1">
                                These arguments are appended whenever {agentDisplayName} starts.
                            </p>
                        </div>
                    )}
                    <div>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <label className="block text-sm text-slate-300">Environment variables</label>
                                <p className="text-xs text-slate-400 mt-1" data-testid="env-summary">
                                    {summaryText}
                                </p>
                            </div>
                            <div className="flex items-center gap-2">
                                <button
                                    type="button"
                                    className={buttonClasses}
                                    style={buttonStyleVars}
                                    onClick={handleToggleEditor}
                                    disabled={loading}
                                    data-testid="toggle-env-vars"
                                    aria-expanded={envEditorOpen}
                                >
                                    {envEditorOpen ? 'Hide editor' : 'Edit variables'}
                                </button>
                                <button
                                    type="button"
                                    className={buttonClasses}
                                    style={buttonStyleVars}
                                    onClick={handleAddVariable}
                                    disabled={loading}
                                    data-testid="add-env-var"
                                >
                                    Add variable
                                </button>
                            </div>
                        </div>
                        {envEditorOpen && (
                            <div
                                className="rounded border mt-3"
                                style={{
                                    borderColor: theme.colors.border.subtle,
                                    backgroundColor: theme.colors.background.elevated,
                                }}
                            >
                                <div
                                    className="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-slate-800"
                                    data-testid="env-vars-scroll"
                                >
                                    {loading ? (
                                        <div className="p-3 text-xs text-slate-400">Loading agent defaults…</div>
                                    ) : envVars.length === 0 ? (
                                        <div className="p-3 text-xs text-slate-400">
                                            No environment variables configured.
                                        </div>
                                    ) : (
                                        envVars.map((item, index) => (
                                            <div
                                                className="grid grid-cols-12 gap-2 p-2"
                                                key={`env-var-${agentType}-${index}`}
                                                data-testid={`env-var-row-${index}`}
                                            >
                                                <input
                                                    data-testid={`env-var-key-${index}`}
                                                    value={item.key}
                                                    onChange={event => onEnvVarChange(index, 'key', event.target.value)}
                                                    placeholder="KEY"
                                                    className="col-span-4 bg-slate-800 text-slate-100 rounded px-2 py-1 border border-slate-700 text-xs"
                                                    disabled={loading}
                                                />
                                                <input
                                                    data-testid={`env-var-value-${index}`}
                                                    value={item.value}
                                                    onChange={event => onEnvVarChange(index, 'value', event.target.value)}
                                                    placeholder="Value"
                                                    className="col-span-7 bg-slate-800 text-slate-100 rounded px-2 py-1 border border-slate-700 text-xs"
                                                    disabled={loading}
                                                />
                                                <button
                                                    type="button"
                                                    data-testid={`env-var-remove-${index}`}
                                                    onClick={() => onRemoveEnvVar(index)}
                                                    className={`col-span-1 ${buttonClasses} !px-0`}
                                                    style={buttonStyleVars}
                                                    disabled={loading}
                                                    title="Remove variable"
                                                >
                                                    Remove
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                            {agentType === 'terminal'
                                ? `Environment variables are available in the ${agentDisplayName} shell.`
                                : `Environment variables are injected into the ${agentDisplayName} process before it starts.`
                            }
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
