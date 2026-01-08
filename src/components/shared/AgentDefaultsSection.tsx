import { useMemo, useState, useRef } from 'react'
import type { CSSProperties } from 'react'
import { AgentType } from '../../types/session'
import { AgentEnvVar, displayNameForAgent } from './agentDefaults'
import { useTranslation } from '../../common/i18n'

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
    const { t } = useTranslation()
    const agentDisplayName = displayNameForAgent(agentType)
    const [envEditorOpen, setEnvEditorOpen] = useState(false)
    const [advancedOpen, setAdvancedOpen] = useState(false)
    const cliArgsRef = useRef<HTMLTextAreaElement | null>(null)
    const buttonStyleVars = useMemo(() => ({
        '--agent-advanced-btn-bg': 'var(--color-bg-elevated)',
        '--agent-advanced-btn-hover': 'var(--color-bg-hover)',
        '--agent-advanced-btn-text': 'var(--color-text-secondary)',
        '--agent-advanced-btn-text-hover': 'var(--color-text-primary)',
        '--agent-advanced-btn-border': 'var(--color-border-subtle)',
    }) as CSSProperties, [])

    const buttonClasses = 'inline-flex items-center justify-center h-8 px-3 rounded-md border text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed bg-[color:var(--agent-advanced-btn-bg)] text-[color:var(--agent-advanced-btn-text)] border-[color:var(--agent-advanced-btn-border)] hover:bg-[color:var(--agent-advanced-btn-hover)] hover:text-[color:var(--agent-advanced-btn-text-hover)] focus:outline-none focus:ring-1 focus:ring-[color:var(--agent-advanced-btn-border)] focus:ring-offset-0'

    const summaryText = useMemo(() => {
        if (loading) {
            return t.agentDefaults.loadingDefaults
        }

        if (envVars.length === 0) {
            return t.agentDefaults.noEnvVarsYet
        }

        const summaryItems = envVars
            .slice(0, 3)
            .map(item => (item.key.trim() ? item.key.trim() : 'Unnamed'))
        const remaining = envVars.length - summaryItems.length

        return remaining > 0
            ? `${summaryItems.join(', ')} and ${remaining} more`
            : summaryItems.join(', ')
    }, [envVars, loading, t.agentDefaults.loadingDefaults, t.agentDefaults.noEnvVarsYet])

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
                    <p className="text-sm text-slate-300">{t.agentDefaults.title}</p>
                    <p className="text-xs text-slate-400 mt-1">
                        {agentType === 'terminal'
                            ? t.agentDefaults.descriptionEnvOnly.replace('{agent}', agentDisplayName)
                            : t.agentDefaults.descriptionWithArgs.replace('{agent}', agentDisplayName)
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
                    {advancedOpen ? t.agentDefaults.hideAdvanced : t.agentDefaults.showAdvanced}
                </button>
            </div>

            {advancedOpen && (
                <div className="space-y-3">
                    {agentType !== 'terminal' && (
                        <div>
                            <label className="block text-sm text-slate-300 mb-1">{t.agentDefaults.defaultCustomArgs}</label>
                            <textarea
                                ref={cliArgsRef}
                                data-testid="agent-cli-args-input"
                                value={cliArgs}
                                onChange={event => onCliArgsChange(event.target.value)}
                                className="w-full bg-slate-800 text-slate-100 rounded px-3 py-2 border border-slate-700 font-mono text-sm"
                                placeholder={t.agentDefaults.argsPlaceholder}
                                rows={2}
                                disabled={loading}
                            />
                            <p className="text-xs text-slate-400 mt-1">
                                {t.agentDefaults.argsHint.replace('{agent}', agentDisplayName)}
                            </p>
                        </div>
                    )}
                    <div>
                        <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="min-w-0">
                                <label className="block text-sm text-slate-300">{t.agentDefaults.envVars}</label>
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
                                    {envEditorOpen ? t.agentDefaults.hideEditor : t.agentDefaults.editVariables}
                                </button>
                                <button
                                    type="button"
                                    className={buttonClasses}
                                    style={buttonStyleVars}
                                    onClick={handleAddVariable}
                                    disabled={loading}
                                    data-testid="add-env-var"
                                >
                                    {t.agentDefaults.addVariable}
                                </button>
                            </div>
                        </div>
                        {envEditorOpen && (
                            <div
                                className="rounded border mt-3"
                                style={{
                                    borderColor: 'var(--color-border-subtle)',
                                    backgroundColor: 'var(--color-bg-elevated)',
                                }}
                            >
                                <div
                                    className="max-h-48 overflow-y-auto custom-scrollbar divide-y divide-slate-800"
                                    data-testid="env-vars-scroll"
                                >
                                    {loading ? (
                                        <div className="p-3 text-xs text-slate-400">{t.agentDefaults.loadingDefaults}</div>
                                    ) : envVars.length === 0 ? (
                                        <div className="p-3 text-xs text-slate-400">
                                            {t.agentDefaults.noEnvVarsConfigured}
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
                                                    placeholder={t.agentDefaults.keyPlaceholder}
                                                    className="col-span-4 bg-slate-800 text-slate-100 rounded px-2 py-1 border border-slate-700 text-xs"
                                                    disabled={loading}
                                                />
                                                <input
                                                    data-testid={`env-var-value-${index}`}
                                                    value={item.value}
                                                    onChange={event => onEnvVarChange(index, 'value', event.target.value)}
                                                    placeholder={t.agentDefaults.valuePlaceholder}
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
                                                    title={t.agentDefaults.remove}
                                                >
                                                    {t.agentDefaults.remove}
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>
                        )}
                        <p className="text-xs text-slate-400 mt-1">
                            {agentType === 'terminal'
                                ? t.agentDefaults.envVarsShellHint.replace('{agent}', agentDisplayName)
                                : t.agentDefaults.envVarsProcessHint.replace('{agent}', agentDisplayName)
                            }
                        </p>
                    </div>
                </div>
            )}
        </div>
    )
}
