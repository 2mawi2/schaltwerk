import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'
import { SessionActions } from '../session/SessionActions'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor })))

interface Props {
  sessionName: string
  editable?: boolean
  debounceMs?: number
  sessionState?: 'spec' | 'running' | 'reviewed'
}

export function SpecContentView({ sessionName, editable = true, debounceMs = 1000, sessionState = 'running' }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    let mounted = true
    setLoading(true)
    setError(null)
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

  // Auto-save
  useEffect(() => {
    if (!editable) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!editable) return
      try {
        setSaving(true)
        await invoke('schaltwerk_core_update_spec_content', { name: sessionName, content })
      } catch (e) {
        console.error('[DraftContentView] Failed to save spec:', e)
      } finally {
        setSaving(false)
      }
    }, debounceMs)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, editable, debounceMs, sessionName])

  const handleCopy = async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(content)
    } catch (err) {
      console.error('[DraftContentView] Failed to copy content:', err)
    } finally {
      setTimeout(() => setCopying(false), 1000)
    }
  }


  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" colorClassName="text-slate-400" size="md" />
      </div>
    )
  }

  if (editable) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="text-xs text-slate-400">
            {saving ? 'Saving…' : error ? <span className="text-red-400">{error}</span> : 'Editing spec'}
          </div>
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
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <AnimatedText text="loading" colorClassName="text-slate-400" size="md" />
          </div>
        }>
          <MarkdownEditor
            value={content}
            onChange={setContent}
            placeholder="Enter agent description in markdown…"
            className="flex-1"
          />
        </Suspense>
      </div>
    )
  }

  const handleMarkReviewed = () => {
    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
      detail: {
        action: 'mark-reviewed',
        sessionId: sessionName
      }
    }))
  }

  const handleCancel = () => {
    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
      detail: {
        action: 'cancel',
        sessionId: sessionName
      }
    }))
  }

  const handleConvertToSpec = () => {
    window.dispatchEvent(new CustomEvent('schaltwerk:session-action', {
      detail: {
        action: 'convert-to-spec',
        sessionId: sessionName
      }
    }))
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs text-slate-400">Agent content</div>
        <div className="flex items-center gap-2">
          {sessionState === 'running' && (
            <SessionActions
              sessionState="running"
              sessionId={sessionName}
              onMarkReviewed={handleMarkReviewed}
              onCancel={handleCancel}
              onConvertToSpec={handleConvertToSpec}
            />
          )}
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
      <div className="flex-1 overflow-auto">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center">
            <AnimatedText text="loading" colorClassName="text-slate-400" size="md" />
          </div>
        }>
          <MarkdownEditor
            value={content}
            onChange={() => {}}
            readOnly={true}
            className="h-full"
          />
        </Suspense>
      </div>
    </div>
  )
}
