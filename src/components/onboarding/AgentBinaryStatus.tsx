import { useState, useEffect } from 'react'
import { useAgentBinarySnapshot } from '../../hooks/useAgentBinarySnapshot'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { useSessionManagement } from '../../hooks/useSessionManagement'
import { useSelection } from '../../hooks/useSelection'
import { theme } from '../../common/theme'
import { withOpacity } from '../../common/colorUtils'
import { displayNameForAgent } from '../shared/agentDefaults'
import { AGENT_TYPES, AgentType } from '../../types/session'

type Status = 'present' | 'missing'

const SELECTABLE_AGENTS: AgentType[] = AGENT_TYPES.filter(
  (agent): agent is AgentType => agent !== 'terminal'
)

function StatusIcon({ status }: { status: Status }) {
  const stroke = status === 'present' ? theme.colors.accent.green.DEFAULT : theme.colors.text.secondary
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
    const previousAgent = selectedDefault
    setSelectedDefault(agent)
    await switchModel(
      agent,
      false,
      { kind: 'orchestrator' },
      terminals,
      previousAgent
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
            borderColor: theme.colors.border.subtle,
            color: theme.colors.text.secondary,
            backgroundColor: theme.colors.background.elevated,
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
            ? theme.colors.accent.blue.DEFAULT
            : status === 'present'
              ? withOpacity(theme.colors.accent.green.DEFAULT, 0.6)
              : theme.colors.border.subtle

          const backgroundColor = isSelected
            ? withOpacity(theme.colors.accent.blue.DEFAULT, 0.1)
            : status === 'present'
              ? withOpacity(theme.colors.accent.green.DEFAULT, 0.04)
              : theme.colors.background.elevated

          return (
            <button
              key={agent}
              onClick={() => { void handleSelectAgent(agent) }}
              className="rounded-lg border px-3 py-2.5 flex flex-col gap-2 text-left transition-all"
              style={{
                borderColor,
                backgroundColor,
                boxShadow: isSelected ? `0 0 0 1px ${theme.colors.accent.blue.DEFAULT}` : theme.shadow.sm,
                color: theme.colors.text.primary,
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
                      backgroundColor: withOpacity(theme.colors.accent.blue.DEFAULT, 0.2),
                      color: theme.colors.accent.blue.light,
                      border: `1px solid ${withOpacity(theme.colors.accent.blue.DEFAULT, 0.5)}`,
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
                          ? withOpacity(theme.colors.accent.green.DEFAULT, 0.18)
                          : withOpacity(theme.colors.border.subtle, 0.35),
                      color: status === 'present' ? theme.colors.text.primary : theme.colors.text.secondary,
                      border: `1px solid ${status === 'present' ? withOpacity(theme.colors.accent.green.DEFAULT, 0.5) : withOpacity(theme.colors.border.subtle, 0.6)}`,
                    }}
                  >
                    {status === 'present' ? 'Found' : 'Missing'}
                  </span>
                )}
              </div>
              <div
                className="text-xs break-all"
                style={{ color: theme.colors.text.secondary }}
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
