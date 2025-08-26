import { useEffect, useState, useCallback, lazy, Suspense } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { VscEdit, VscPlay, VscTrash, VscSave, VscClose, VscAdd, VscCopy } from 'react-icons/vsc'
import { ConfirmModal } from '../modals/ConfirmModal'
import clsx from 'clsx'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor })))

interface PlanSession {
  name: string
  created_at: string
  initial_prompt?: string
  draft_content?: string
  state: 'plan'
}

export function PlanAgentPanel() {
  const [plans, setDrafts] = useState<PlanSession[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [editingDraft, setEditingDraft] = useState<string | null>(null)
  const [editContent, setEditContent] = useState('')
  const [saving, setSaving] = useState(false)
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null)
  const [deleting, setDeleting] = useState(false)
  const [starting, setStarting] = useState<string | null>(null)
  const [copying, setCopying] = useState<string | null>(null)

  const fetchDrafts = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const sessions = await invoke<PlanSession[]>('schaltwerk_core_list_sessions_by_state', { state: 'plan' })
      setDrafts(sessions || [])
    } catch (err) {
      console.error('[PlanAgentPanel] Failed to fetch plans:', err)
      setError('Failed to load plan agents')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchDrafts()
  }, [fetchDrafts])
  
  // Listen for sessions-refreshed events from backend
  useEffect(() => {
    const setupListener = async () => {
      const unlisten = await listen('schaltwerk:sessions-refreshed', () => {
        fetchDrafts()
      })
      
      return unlisten
    }
    
    const cleanupPromise = setupListener()
    return () => {
      cleanupPromise.then(fn => fn())
    }
  }, [fetchDrafts])

  const handleEdit = (plan: PlanSession) => {
    setEditingDraft(plan.name)
    setEditContent(plan.draft_content || plan.initial_prompt || '')
  }

  const handleCancelEdit = () => {
    setEditingDraft(null)
    setEditContent('')
  }

  const handleSaveEdit = async () => {
    if (!editingDraft) return
    
    try {
      setSaving(true)
      await invoke('schaltwerk_core_update_draft_content', { 
        name: editingDraft, 
        content: editContent 
      })
      await fetchDrafts()
      setEditingDraft(null)
      setEditContent('')
    } catch (err) {
      console.error('[PlanAgentPanel] Failed to save plan:', err)
      setError('Failed to save plan changes')
    } finally {
      setSaving(false)
    }
  }

  const handleStart = async (sessionName: string) => {
    try {
      setStarting(sessionName)
      setError(null)
      // Open Start new agent modal prefilled from plan instead of starting directly
      window.dispatchEvent(new CustomEvent('schaltwerk:start-agent-from-plan', { detail: { name: sessionName } }))
    } catch (err) {
      console.error('[PlanAgentPanel] Failed to open start modal from plan:', err)
      setError('Failed to open start modal')
    } finally {
      setStarting(null)
    }
  }

  const handleDelete = async () => {
    if (!deleteConfirm) return
    
    try {
      setDeleting(true)
      await invoke('schaltwerk_core_cancel_session', { name: deleteConfirm })
      await fetchDrafts()
      setDeleteConfirm(null)
    } catch (err) {
      console.error('[PlanAgentPanel] Failed to delete plan:', err)
      setError('Failed to delete plan')
    } finally {
      setDeleting(false)
    }
  }

  const handleCopy = async (plan: PlanSession) => {
    try {
      setCopying(plan.name)
      const contentToCopy = plan.draft_content || plan.initial_prompt || ''
      await navigator.clipboard.writeText(contentToCopy)
    } catch (err) {
      console.error('[PlanAgentPanel] Failed to copy content:', err)
      setError('Failed to copy content')
    } finally {
      setTimeout(() => setCopying(null), 1000)
    }
  }

  const getPreview = (content?: string) => {
    if (!content) return 'No content'
    const lines = content.split('\n').filter(line => line.trim())
    const preview = lines.slice(0, 3).join(' ')
    return preview.length > 100 ? preview.substring(0, 100) + '...' : preview
  }

  const formatDate = (dateString: string) => {
    try {
      const date = new Date(dateString)
      return date.toLocaleDateString(undefined, { 
        month: 'short', 
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit'
      })
    } catch {
      return dateString
    }
  }

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <div className="text-center">
          <div className="inline-block h-8 w-8 animate-spin rounded-full border-2 border-slate-600 border-t-transparent mb-2" />
          <p>Loading plan agents...</p>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="h-full flex items-center justify-center text-red-400">
        <div className="text-center">
          <p className="mb-2">{error}</p>
          <button
            onClick={fetchDrafts}
            className="px-3 py-1 text-sm bg-slate-800 hover:bg-slate-700 rounded border border-slate-700"
          >
            Retry
          </button>
        </div>
      </div>
    )
  }

  if (plans.length === 0) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400">
        <div className="text-center">
          <VscAdd className="text-4xl mx-auto mb-3 opacity-50" />
          <p className="mb-1">No plan agents</p>
          <p className="text-sm text-slate-500">Create one to get started!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-4 py-3 border-b border-slate-800">
        <h2 className="text-sm font-semibold text-slate-200">Plan Agents</h2>
        <p className="text-xs text-slate-400 mt-0.5">{plans.length} plan{plans.length !== 1 ? 's' : ''}</p>
      </div>
      
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {plans.map((plan) => (
          <div
            key={plan.name}
            className="bg-slate-800/50 border border-slate-700 rounded-lg p-3 hover:border-slate-600 transition-colors"
          >
            {editingDraft === plan.name ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="text-sm font-medium text-slate-200">{plan.name}</h3>
                  <div className="flex gap-2">
                    <button
                      onClick={handleSaveEdit}
                      disabled={saving}
                      className={clsx(
                        'px-2 py-1 text-xs rounded flex items-center gap-1',
                        'bg-green-700 hover:bg-green-600 text-white',
                        'disabled:opacity-50 disabled:cursor-not-allowed'
                      )}
                      title="Save changes"
                    >
                      <VscSave />
                      {saving ? 'Saving...' : 'Save'}
                    </button>
                    <button
                      onClick={handleCancelEdit}
                      disabled={saving}
                      className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center gap-1"
                      title="Cancel editing"
                    >
                      <VscClose />
                      Cancel
                    </button>
                  </div>
                </div>
                <div className="h-48 border border-slate-700 rounded overflow-hidden">
                  <Suspense fallback={
                    <div className="h-full flex items-center justify-center text-slate-400">
                      Loading editor...
                    </div>
                  }>
                    <MarkdownEditor
                      value={editContent}
                      onChange={setEditContent}
                      placeholder="Enter agent description in markdown..."
                      className="h-full"
                    />
                  </Suspense>
                </div>
              </div>
            ) : (
              <>
                <div className="flex items-start justify-between mb-2">
                  <div className="flex-1 min-w-0">
                    <h3 className="text-sm font-medium text-slate-200 truncate">{plan.name}</h3>
                    <p className="text-xs text-slate-400 mt-0.5">{formatDate(plan.created_at)}</p>
                  </div>
                </div>
                
                <div className="mb-3">
                  {(plan.draft_content || plan.initial_prompt) ? (
                    <div className="text-xs text-slate-300 bg-slate-800/50 rounded overflow-hidden max-h-20">
                      <Suspense fallback={
                        <div className="p-2 text-slate-400">Loading preview...</div>
                      }>
                        <MarkdownEditor
                          value={getPreview(plan.draft_content || plan.initial_prompt)}
                          onChange={() => {}}
                          readOnly={true}
                          className="h-20"
                        />
                      </Suspense>
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500 italic">No content</p>
                  )}
                </div>
                
                <div className="flex gap-2">
                  <button
                    onClick={() => handleStart(plan.name)}
                    disabled={starting === plan.name}
                    className="px-2 py-1 text-xs rounded bg-green-700 hover:bg-green-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Start this agent"
                  >
                    <VscPlay />
                    {starting === plan.name ? 'Starting...' : 'Start'}
                  </button>
                  <button
                    onClick={() => handleEdit(plan)}
                    className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-slate-200 flex items-center gap-1"
                    title="Edit plan content"
                  >
                    <VscEdit />
                    Edit
                  </button>
                  <button
                    onClick={() => handleCopy(plan)}
                    disabled={copying === plan.name}
                    className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="Copy agent content"
                  >
                    <VscCopy />
                    {copying === plan.name ? 'Copied!' : 'Copy'}
                  </button>
                  <button
                    onClick={() => setDeleteConfirm(plan.name)}
                    className="px-2 py-1 text-xs rounded bg-red-700 hover:bg-red-600 text-white flex items-center gap-1"
                    title="Delete plan"
                  >
                    <VscTrash />
                    Delete
                  </button>
                </div>
              </>
            )}
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!deleteConfirm}
        title="Delete Plan Agent"
        body={
          <p className="text-sm text-slate-300">
            Are you sure you want to delete <strong className="text-slate-100">{deleteConfirm}</strong>? 
            This action cannot be undone.
          </p>
        }
        confirmText="Delete"
        onConfirm={handleDelete}
        onCancel={() => setDeleteConfirm(null)}
        loading={deleting}
        variant="danger"
      />
    </div>
  )
}