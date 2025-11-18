import { useAgentBinarySnapshot } from '../../hooks/useAgentBinarySnapshot'
import { theme } from '../../common/theme'
import { withOpacity } from '../../common/colorUtils'
import { displayNameForAgent } from '../shared/agentDefaults'
import { AGENT_TYPES } from '../../types/session'

type Status = 'present' | 'missing'

function statusStyles(status: Status) {
  if (status === 'present') {
    return {
      borderColor: withOpacity(theme.colors.accent.green.DEFAULT, 0.6),
      color: theme.colors.text.primary,
      backgroundColor: withOpacity(theme.colors.accent.green.DEFAULT, 0.04),
    }
  }
  return {
    borderColor: theme.colors.border.subtle,
    color: theme.colors.text.secondary,
    backgroundColor: theme.colors.background.elevated,
  }
}

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

  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <div className="text-slate-200 text-sm font-semibold">Agent CLI availability</div>
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
      <div className="grid grid-cols-2 gap-2.5">
        {AGENT_TYPES.map(agent => {
          const status = statusByAgent[agent]?.status ?? 'missing'
          const preferred = statusByAgent[agent]?.preferredPath ?? null
          const styles = statusStyles(status)
          return (
            <div
              key={agent}
              className="rounded-lg border px-3 py-2.5 flex flex-col gap-2"
              style={{
                ...styles,
                boxShadow: theme.shadow.sm,
              }}
            >
              <div className="flex items-center justify-between text-sm font-semibold">
                <span className="flex items-center gap-2">
                  <StatusIcon status={status} />
                  {displayNameForAgent(agent)}
                </span>
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
              </div>
              <div
                className="text-xs break-all"
                style={{ color: status === 'present' ? theme.colors.text.secondary : theme.colors.text.secondary }}
              >
                {preferred ?? 'No path detected'}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
