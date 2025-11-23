import { AgentBinaryStatus } from '../../hooks/useAgentBinarySnapshot'
import { theme } from '../../common/theme'
import { displayNameForAgent } from '../shared/agentDefaults'
import { AGENT_TYPES } from '../../types/session'

interface Props {
  open: boolean
  onClose: () => void
  onOpenSettings: () => void
  loading: boolean
  statusByAgent: Record<string, AgentBinaryStatus>
  onRefresh: () => void
}

function StatusList({ items }: { items: Record<string, { status: 'present' | 'missing'; preferredPath: string | null }> }) {
  return (
    <div className="space-y-2">
      {AGENT_TYPES.map(agent => {
        const status = items[agent]?.status ?? 'missing'
        const preferred = items[agent]?.preferredPath ?? null
        const color = status === 'present' ? theme.colors.accent.green.DEFAULT : theme.colors.text.secondary
        return (
          <div
            key={agent}
            className="flex items-start justify-between border rounded px-3 py-2"
            style={{ borderColor: theme.colors.border.subtle }}
          >
            <div>
              <div className="text-sm" style={{ color: theme.colors.text.primary }}>
                {displayNameForAgent(agent)}
              </div>
              <div className="text-xs" style={{ color: theme.colors.text.secondary }}>
                {preferred ?? 'No path detected'}
              </div>
            </div>
            <div className="text-xs font-semibold" style={{ color }}>
              {status === 'present' ? 'Found' : 'Missing'}
            </div>
          </div>
        )
      })}
    </div>
  )
}

export function AgentCliMissingModal({ open, onClose, onOpenSettings, loading, statusByAgent, onRefresh }: Props) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/70" />
      <div className="relative z-10 w-[640px] max-w-[95vw] bg-slate-900 border border-slate-700 rounded-xl shadow-2xl p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold text-slate-100">No agent CLIs detected</h2>
          <button
            onClick={onClose}
            className="text-slate-400 hover:text-slate-200"
            aria-label="Close"
          >
            ×
          </button>
        </div>
        <p className="text-sm text-slate-300">
          We couldn't find any supported agent command-line binaries. Install one (e.g., via Homebrew) or set a custom path in Settings → Agent Configuration, then re-run detection.
        </p>
        <StatusList items={statusByAgent} />
        <div className="flex gap-3 justify-end">
          <button
            onClick={onRefresh}
            className="px-3 py-1.5 rounded border text-sm"
            style={{
              borderColor: theme.colors.border.subtle,
              color: theme.colors.text.secondary,
              backgroundColor: theme.colors.background.elevated,
            }}
            disabled={loading}
          >
            {loading ? 'Scanning…' : 'Re-run detection'}
          </button>
          <button
            onClick={onOpenSettings}
            className="px-3 py-1.5 rounded text-sm text-white"
            style={{ backgroundColor: theme.colors.accent.blue.dark }}
          >
            Open Settings
          </button>
        </div>
      </div>
    </div>
  )
}
