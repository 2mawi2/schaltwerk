import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { VscCopy, VscPlay } from 'react-icons/vsc'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor })))

interface Props {
  sessionName: string
  onStart?: () => void
}

export function PlanEditor({ sessionName, onStart }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSessionNameRef = useRef<string>(sessionName)

  // Load initial content
  useEffect(() => {
    let mounted = true
    lastSessionNameRef.current = sessionName
    setLoading(true)
    setError(null)
    setHasLocalChanges(false)
    invoke<[string | null, string | null]>('schaltwerk_core_get_session_agent_content', { name: sessionName })
      .then(([draftContent, initialPrompt]) => {
        if (!mounted) return
        const text: string = draftContent ?? initialPrompt ?? ''
        setContent(text)
      })
      .catch((e) => {
        if (!mounted) return
        setError(String(e))
      })
      .finally(() => mounted && setLoading(false))
    return () => { mounted = false }
  }, [sessionName])

  // Auto-save content only when there are local changes
  useEffect(() => {
    if (!hasLocalChanges) return
    
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        setSaving(true)
        await invoke('schaltwerk_core_update_spec_content', { name: sessionName, content })
        setHasLocalChanges(false)
      } catch (e) {
        console.error('[DraftEditor] Failed to save spec:', e)
      } finally {
        setSaving(false)
      }
    }, 1000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, sessionName, hasLocalChanges])

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasLocalChanges(true)
  }

  const handleCopy = async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(content)
    } catch (err) {
      console.error('[DraftEditor] Failed to copy content:', err)
    } finally {
      setTimeout(() => setCopying(false), 1000)
    }
  }

  const handleRun = async () => {
    if (!onStart) return
    try {
      setStarting(true)
      setError(null)
      onStart()
    } catch (e: any) {
      console.error('[DraftEditor] Failed to start spec:', e)
      setError(String(e))
    } finally {
      setStarting(false)
    }
  }

  // Listen for sessions refreshed events (e.g., from MCP updates)
  useEffect(() => {
    console.log('[PlanEditor] Setting up sessions-refreshed listener for session:', sessionName)
    
    const unlistenPromise = listen('schaltwerk:sessions-refreshed', async (event) => {
      console.log('[PlanEditor] Received sessions-refreshed event')
      const sessions = event.payload as any[]
      console.log('[PlanEditor] Total sessions in event:', sessions.length)
      
      // Log all plan sessions for debugging
      const specSessions = sessions.filter((s: any) => 
        s.info?.session_state === 'plan' || s.info?.status === 'plan'
      )
      console.log('[PlanEditor] specSessions.map:', specSessions.map((s: any) => ({
        id: s.info?.session_id,
        state: s.info?.session_state,
        status: s.info?.status,
        has_content: !!s.info?.spec_content,
        content_length: s.info?.spec_content?.length || 0
      })))
      
      const specSession = sessions.find((s: any) => 
        s.info?.session_id === sessionName && 
        (s.info?.session_state === 'plan' || s.info?.status === 'plan')
      )
      
      console.log('[PlanEditor] Looking for session:', sessionName)
      console.log('[PlanEditor] Found matching session:', !!specSession)
      
      if (specSession) {
        console.log('[PlanEditor] Spec session details:', {
          id: specSession.info?.session_id,
          has_spec_content: specSession.info?.spec_content !== undefined,
          content_length: specSession.info?.spec_content?.length || 0,
          current_content_length: content.length
        })
        
        if (specSession.info?.spec_content !== undefined) {
          // Only update if content actually changed to avoid infinite loops
          if (specSession.info.spec_content !== content) {
            console.log('[PlanEditor] Content changed, updating from', content.length, 'to', specSession.info.spec_content.length, 'chars')
            setContent(specSession.info.spec_content || '')
            setHasLocalChanges(false)
          } else {
            console.log('[PlanEditor] Content unchanged, skipping update')
          }
        } else {
          console.log('[PlanEditor] No spec_content field in session data')
        }
      } else {
        console.log('[PlanEditor] No matching plan session found for:', sessionName)
      }
    })
    
    return () => {
      console.log('[PlanEditor] Cleaning up sessions-refreshed listener for:', sessionName)
      unlistenPromise.then(unlisten => unlisten())
    }
  }, [sessionName, content])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !starting) {
        e.preventDefault()
        handleRun()
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleRun, starting])

  if (loading) {
    return <div className="h-full flex items-center justify-center text-slate-400">Loading…</div>
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      {/* Header with read-only title */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">{sessionName}</h2>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleRun}
            disabled={starting}
            className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Run agent (⌘⏎)"
          >
            <VscPlay />
            {starting ? 'Starting…' : 'Run Agent'}
          </button>
          <button
            onClick={handleCopy}
            disabled={copying || !content}
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copy agent content"
          >
            <VscCopy />
            {copying ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>
      
      {/* Status bar */}
      <div className="px-4 py-1 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {saving ? 'Saving…' : error ? <span className="text-red-400">{error}</span> : 'Editing spec'}
        </div>
      </div>
      
      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center text-slate-400">
            Loading editor...
          </div>
        }>
          <MarkdownEditor
            value={content}
            onChange={handleContentChange}
            placeholder="Enter agent description in markdown…"
            className="h-full"
          />
        </Suspense>
      </div>
    </div>
  )
}