import { useCallback, useEffect, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { VscAdd, VscCopy } from 'react-icons/vsc'

interface DraftSession {
  name: string
  created_at: string
  initial_prompt?: string
  draft_content?: string
  state: 'draft'
}

interface Props {
  onOpenDraft: (name: string) => void
}

export function DraftListView({ onOpenDraft }: Props) {
  const [drafts, setDrafts] = useState<DraftSession[]>([])
  const [loading, setLoading] = useState(true)
  const [copying, setCopying] = useState<string | null>(null)

  const fetchDrafts = useCallback(async () => {
    setLoading(true)
    try {
      const sessions = await invoke<DraftSession[]>('para_core_list_sessions_by_state', { state: 'draft' })
      setDrafts(sessions || [])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    const attach = async () => {
      try {
        unlisten = await listen('schaltwerk:sessions-refreshed', () => { fetchDrafts() })
      } catch (e) {
        // In tests, tauri event bridge may not exist; ignore
        console.warn('[DraftListView] Failed to attach sessions-refreshed listener', e)
      }
    }
    attach()
    return () => { try { if (unlisten) unlisten() } catch {} }
  }, [fetchDrafts])

  const handleCopy = async (draft: DraftSession, event: React.MouseEvent) => {
    event.stopPropagation()
    try {
      setCopying(draft.name)
      const contentToCopy = draft.draft_content || draft.initial_prompt || ''
      await navigator.clipboard.writeText(contentToCopy)
    } catch (err) {
      console.error('[DraftListView] Failed to copy content:', err)
    } finally {
      setTimeout(() => setCopying(null), 1000)
    }
  }

  if (loading) {
    return <div className="h-full flex items-center justify-center text-slate-400">Loading drafts…</div>
  }

  if (drafts.length === 0) {
    return (
      <div className="h-full overflow-auto p-3">
        <div
          className="w-full border-2 border-dashed border-amber-700/40 rounded-lg px-3 py-3 bg-amber-950/20 hover:bg-amber-900/25 text-amber-200 cursor-pointer flex items-center justify-between"
          onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-draft'))}
          title="Create draft (⇧⌘N)"
          role="button"
          aria-label="Create new draft"
        >
          <div className="flex items-center gap-2">
            <VscAdd className="text-amber-300" />
            <div className="text-sm font-medium">Create new draft</div>
          </div>
          <span className="text-[10px] opacity-75">⇧⌘N</span>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full overflow-auto p-3 space-y-2">
      {drafts.map((d) => (
        <div
          key={d.name}
          className="group w-full bg-slate-900/40 hover:bg-slate-900/60 border border-slate-800 hover:border-slate-700 rounded-lg px-3 py-2 cursor-pointer transition-colors"
          onClick={() => onOpenDraft(d.name)}
        >
          <div className="flex items-center justify-between gap-2">
            <div className="text-sm font-medium text-slate-200 truncate">{d.name}</div>
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => handleCopy(d, e)}
                disabled={copying === d.name}
                className="p-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed opacity-0 group-hover:opacity-100 transition-opacity"
                title="Copy task content"
              >
                <VscCopy />
                {copying === d.name ? 'Copied!' : ''}
              </button>
              <span className="text-[10px] px-1.5 py-0.5 rounded border bg-amber-900/20 text-amber-300 border-amber-700/40">Draft</span>
            </div>
          </div>
          <div className="text-xs text-slate-500 mt-0.5">{new Date(d.created_at).toLocaleString()}</div>
        </div>
      ))}
      {/* Integrated create-new item under the list */}
      <div
        className="w-full border-2 border-dashed border-amber-700/40 rounded-lg px-3 py-3 bg-amber-950/20 hover:bg-amber-900/25 text-amber-200 cursor-pointer flex items-center justify-between"
        onClick={() => window.dispatchEvent(new CustomEvent('schaltwerk:new-draft'))}
        title="Create draft (⇧⌘N)"
        role="button"
        aria-label="Create new draft"
      >
        <div className="flex items-center gap-2">
          <VscAdd className="text-amber-300" />
          <div className="text-sm font-medium">Create new draft</div>
        </div>
        <span className="text-[10px] opacity-75">⇧⌘N</span>
      </div>
    </div>
  )
}
