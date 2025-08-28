import { useState, useMemo } from 'react'
import { useSessions } from '../../contexts/SessionsContext'
import { VscAdd, VscCopy } from 'react-icons/vsc'

interface PlanSession {
  name: string
  created_at: string
  initial_prompt?: string
  draft_content?: string
  state: 'plan'
}

interface Props {
  onOpenPlan: (name: string) => void
}

export function PlanListView({ onOpenPlan }: Props) {
  const { sessions } = useSessions()
  const [copying, setCopying] = useState<string | null>(null)

  // Extract plan sessions from the global sessions context
  const plans = useMemo(() => {
    return sessions.filter(session => 
      session.info.status === 'plan' || session.info.session_state === 'plan'
    ).map(session => ({
      name: session.info.session_id,
      created_at: session.info.created_at || '',
      initial_prompt: session.info.current_task || '',
      draft_content: '', // This would need to be fetched separately if needed
      state: 'plan' as const
    }))
  }, [sessions])

  const handleCopy = async (plan: PlanSession, event: React.MouseEvent) => {
    event.stopPropagation()
    try {
      setCopying(plan.name)
      const contentToCopy = plan.draft_content || plan.initial_prompt || ''
      await navigator.clipboard.writeText(contentToCopy)
    } catch (err) {
      console.error('[PlanListView] Failed to copy content:', err)
    } finally {
      setTimeout(() => setCopying(null), 1000)
    }
  }

  if (plans.length === 0) {
    return (
      <div className="h-full overflow-auto p-3">
        <div
          className="w-full border-2 border-dashed border-amber-700/40 rounded-lg px-3 py-3 bg-amber-950/20 hover:bg-amber-900/25 text-amber-200 cursor-pointer flex items-center justify-between"
          onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-plan'))}
          title="Create plan (⇧⌘N)"
          role="button"
          aria-label="Create new plan"
        >
          <div className="flex items-center gap-2">
            <VscAdd className="text-amber-300" />
            <div className="text-sm font-medium">Create new plan</div>
          </div>
          <span className="text-[10px] opacity-75">⇧⌘N</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-3 space-y-2">
      {plans.map((d) => (
        <div
          key={d.name}
          className="group w-full bg-slate-900/40 hover:bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-lg px-3 py-2 cursor-pointer transition-colors"
          onClick={() => onOpenPlan(d.name)}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-200 truncate">{d.name}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => handleCopy(d, e)}
                disabled={copying === d.name}
                className="p-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 transition-opacity"
                title="Copy agent content"
              >
                <VscCopy />
                {copying === d.name ? 'Copied!' : ''}
              </button>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-900/20 text-amber-300 border-amber-700/40">Plan</span>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{new Date(d.created_at).toLocaleString()}</div>
        </div>
      ))}
      {/* Integrated create-new item under the list */}
      <div
        className="w-full border-2 border-dashed border-amber-700/40 rounded-lg px-3 py-3 bg-amber-950/20 hover:bg-amber-900/25 text-amber-200 cursor-pointer flex items-center justify-between"
        onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-plan'))}
        title="Create plan (⇧⌘N)"
        role="button"
        aria-label="Create new plan"
      >
        <div className="flex items-center gap-2">
          <VscAdd className="text-amber-300" />
          <div className="text-sm font-medium">Create new plan</div>
        </div>
        <span className="text-[10px] opacity-75">⇧⌘N</span>
      </div>
    </div>
  )
}
