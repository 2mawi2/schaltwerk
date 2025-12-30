import { useState, useEffect } from 'react'
import { useAgentBinarySnapshot } from '../../hooks/useAgentBinarySnapshot'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { useSelection } from '../../hooks/useSelection'
import { theme } from '../../common/theme'
import { displayNameForAgent } from '../shared/agentDefaults'
import { AGENT_TYPES, AgentType } from '../../types/session'

type Status = 'present' | 'missing'

const SELECTABLE_AGENTS: AgentType[] = AGENT_TYPES.filter(
  (agent): agent is AgentType => agent !== 'terminal'
)

function StatusIcon({ status }: { status: Status }) {
  const stroke = status === 'present' ? 'var(--color-accent-green)' : 'var(--color-text-secondary)'
  return (
    <svg className="w-4 h-4" viewBox="0 0 20 20" fill="none" stroke={stroke} strokeWidth={2}>
      <circle cx="10" cy="10" r="9" />
      {status === 'present' ? <path d="M6 10.5l2.5 2.5L14 7" /> : <path d="M6.5 10h7" />}
    </svg>
  )
}

export function AgentBinaryStatus() {
  const { loading, error, statusByAgent, allMissing, refresh } = useAgentBinarySnapshot()
  const { getOrchestratorAgentType } = useClaudeSession()
  const { switchModel } = useSessionManagement()
  const { terminals } = useSelection()
  const [selectedDefault, setSelectedDefault] = useState<AgentType>('claude')

  useEffect(() => {
    void getOrchestratorAgentType().then((agent) => {
      if (SELECTABLE_AGENTS.includes(agent as AgentType)) {
        setSelectedDefault(agent as AgentType)
      }
    })
  }, [getOrchestratorAgentType])

  const handleSelectAgent = async (agent: AgentType) => {
    if (agent === 'terminal') return
    setSelectedDefault(agent)
    await switchModel(
      agent,
      false,
      { kind: 'orchestrator' },
      terminals
    )
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-slate-200 text-sm font-semibold">Select your default agent</div>
        <button
          onClick={() => { void refresh() }}
          className="px-2 py-1 text-xs rounded border"
          style={{
            borderColor: 'var(--color-border-subtle)',
            color: 'var(--color-text-secondary)',
            backgroundColor: 'var(--color-bg-elevated)',
          }}
        >
          Refresh
        </button>
        {loading && <span className="text-xs text-slate-400">Scanning…</span>}
        {error && <span className="text-xs text-red-400">Failed: {error}</span>}
        {!loading && !error && allMissing && (
          <span className="text-xs text-amber-400">No CLIs found</span>
        )}
      </div>
      <p className="text-xs text-slate-400">
        Click on an agent to set it as your default. This is the agent that will start in the orchestrator.
      </p>
      <div className="grid grid-cols-2 gap-2.5">
        {SELECTABLE_AGENTS.map(agent => {
          const status = statusByAgent[agent]?.status ?? 'missing'
          const preferred = statusByAgent[agent]?.preferredPath ?? null
          const isSelected = selectedDefault === agent

          const borderColor = isSelected
            ? 'var(--color-accent-blue)'
            : status === 'present'
              ? 'rgba(var(--color-accent-green-rgb), 0.6)'
              : 'var(--color-border-subtle)'

          const backgroundColor = isSelected
            ? 'rgba(var(--color-accent-blue-rgb), 0.1)'
            : status === 'present'
              ? 'rgba(var(--color-accent-green-rgb), 0.04)'
              : 'var(--color-bg-elevated)'

          return (
            <button
              key={agent}
              onClick={() => { void handleSelectAgent(agent) }}
              className="rounded-lg border px-3 py-2.5 flex flex-col gap-2 text-left transition-all"
              style={{
                borderColor,
                backgroundColor,
                boxShadow: isSelected ? '0 0 0 1px var(--color-accent-blue)' : theme.shadow.sm,
                color: 'var(--color-text-primary)',
              }}
            >
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <StatusIcon status={status} />
                  {displayNameForAgent(agent)}
                </span>
                {isSelected ? (
                  <span
                    className="text-xs px-2.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor: 'rgba(var(--color-accent-blue-rgb), 0.2)',
                      color: 'var(--color-accent-blue-light)',
                      border: '1px solid rgba(var(--color-accent-blue-rgb), 0.5)',
                    }}
                  >
                    Default
                  </span>
                ) : (
                  <span
                    className="text-xs px-2.5 py-0.5 rounded-full"
                    style={{
                      backgroundColor:
                        status === 'present'
                          ? 'rgba(var(--color-accent-green-rgb), 0.18)'
                          : 'rgba(var(--color-border-subtle-rgb), 0.35)',
                      color: status === 'present' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)',
                      border: `1px solid ${status === 'present' ? 'rgba(var(--color-accent-green-rgb), 0.5)' : 'rgba(var(--color-border-subtle-rgb), 0.6)'}`,
                    }}
                  >
                    {status === 'present' ? 'Found' : 'Missing'}
                  </span>
                )}
              </div>
              <div
                className="text-xs break-all"
                style={{ color: 'var(--color-text-secondary)' }}
              >
                {preferred ?? 'No path detected'}
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
