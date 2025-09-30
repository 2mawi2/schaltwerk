import { useEffect, useRef, useState, lazy, Suspense, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import type { MarkdownEditorRef } from './MarkdownEditor'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor })))

const sessionContentCache = new Map<string, string>()

interface Props {
  sessionName: string
  editable?: boolean
  debounceMs?: number
  sessionState?: 'spec' | 'running' | 'reviewed'
}

export function SpecContentView({ sessionName, editable = true, debounceMs = 1000 }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)
  const sessionCacheRef = useRef(sessionContentCache)
  const loadTokenRef = useRef(0)

  const updateContent = useCallback((value: string) => {
    setContent(value)
    sessionCacheRef.current.set(sessionName, value)
  }, [sessionName])

  useEffect(() => {
    let mounted = true
    const token = ++loadTokenRef.current

    const cachedContent = sessionCacheRef.current.get(sessionName)
    if (cachedContent !== undefined) {
      setContent(cachedContent)
      setLoading(false)
    } else {
      setContent('')
      setLoading(true)
    }

    setError(null)

    if (cachedContent !== undefined && !editable) {
      return () => { mounted = false }
    }

    invoke<[string | null, string | null]>(TauriCommands.SchaltwerkCoreGetSessionAgentContent, { name: sessionName })
      .then(([draftContent, initialPrompt]) => {
        if (!mounted) return
        if (loadTokenRef.current !== token) return
        const text: string = draftContent ?? initialPrompt ?? ''
        sessionCacheRef.current.set(sessionName, text)
        setContent(text)
        setLoading(false)
      })
      .catch((e) => {
        if (!mounted) return
        if (loadTokenRef.current !== token) return
        logger.error('Failed to get spec content:', e)
        setError(String(e))
        setLoading(false)
      })
    return () => { mounted = false }
  }, [sessionName, editable])

  // Auto-save
  useEffect(() => {
    if (!editable) return
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      if (!editable) return
      try {
        setSaving(true)
        await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, { name: sessionName, content })
      } catch (e) {
        logger.error('[DraftContentView] Failed to save spec:', e)
      } finally {
        setSaving(false)
      }
    }, debounceMs)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, editable, debounceMs, sessionName])

  // Local copy button removed

  // Handle Cmd+T to focus spec content
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 't' || e.key === 'T')) {
        // Focus the spec editor
        e.preventDefault()
        // Removed stopPropagation() to allow cmd+e to work
        
        // Focus the markdown editor
        if (markdownEditorRef.current) {
          markdownEditorRef.current.focus()
          logger.info('[SpecContentView] Focused spec content via Cmd+T')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown) // Use bubble phase to not interfere with cmd+e
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [])


  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" size="md" />
      </div>
    )
  }

  if (editable) {
    return (
      <div className="h-full flex flex-col">
        <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="text-xs text-slate-400">
              {saving ? 'Saving…' : error ? <span className="text-red-400">{error}</span> : 'Editing spec'}
            </div>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400" title="Focus spec content (⌘T)">⌘T</span>
          </div>
          {/* Copy button removed in favor of Copy Bundle bar in RightPanel */}
        </div>
        <Suspense fallback={
          <div className="flex-1 flex items-center justify-center">
            <AnimatedText text="loading" size="md" />
          </div>
        }>
          <MarkdownEditor
            ref={markdownEditorRef}
            value={content}
            onChange={updateContent}
            placeholder="Enter agent description in markdown…"
            className="flex-1"
          />
        </Suspense>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className="text-xs text-slate-400">Spec</div>
        </div>
        <div className="flex items-center gap-2" />
      </div>
      <div className="flex-1 overflow-auto">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center">
            <AnimatedText text="loading" size="md" />
          </div>
        }>
          <MarkdownEditor
            ref={markdownEditorRef}
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

export function __clearSpecContentCacheForTests() {
  if (process.env.NODE_ENV === 'test') {
    sessionContentCache.clear()
  }
}
