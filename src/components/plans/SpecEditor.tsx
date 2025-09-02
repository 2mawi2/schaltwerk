import { useEffect, useRef, useState, lazy, Suspense } from 'react'
import { useCallback } from 'react'
import { SchaltEvent, listenEvent } from '../../common/eventSystem'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscPlay } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'

const MarkdownEditor = lazy(() => import('./MarkdownEditor').then(m => ({ default: m.MarkdownEditor })))

interface Props {
  sessionName: string
  onStart?: () => void
}

export function SpecEditor({ sessionName, onStart }: Props) {
  const [content, setContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [hasLocalChanges, setHasLocalChanges] = useState(false)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastSessionNameRef = useRef<string>(sessionName)
  const lastServerContentRef = useRef<string>('')

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
        lastServerContentRef.current = text
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
        lastServerContentRef.current = content
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

  const handleRun = useCallback(async () => {
    if (!onStart) return
    try {
      setStarting(true)
      setError(null)
      onStart()
    } catch (e: unknown) {
      console.error('[DraftEditor] Failed to start spec:', e)
      setError(String(e))
    } finally {
      setStarting(false)
    }
  }, [onStart])

  // Listen for sessions refreshed events (e.g., from MCP updates)
  useEffect(() => {
    console.log('[SpecEditor] Setting up sessions-refreshed listener for session:', sessionName)
    
    const unlistenPromise = listenEvent(SchaltEvent.SessionsRefreshed, async (event) => {
      console.log('[SpecEditor] Received sessions-refreshed event')
      const sessions = event as any[]

      const specSession = sessions.find((s: any) => 
        s.info?.session_id === sessionName && 
        (s.info?.session_state === 'spec' || s.info?.status === 'spec')
      )
      
      if (!specSession || specSession.info?.spec_content === undefined) {
        return
      }
      
      const serverContent = specSession.info.spec_content || ''
      
      // Skip update if we have local changes pending save - let the user finish typing
      if (hasLocalChanges) {
        console.log('[SpecEditor] Skipping refresh - local changes pending')
        return
      }
      
      // Only update if the server content actually changed from what we last knew
      // This prevents unnecessary flashing when sessions refresh but content hasn't changed
      if (serverContent === lastServerContentRef.current) {
        console.log('[SpecEditor] Server content unchanged, skipping update')
        return
      }
      
      // Also skip if current content matches server content (user hasn't made changes)
      if (serverContent === content) {
        console.log('[SpecEditor] Content already matches server, updating reference only')
        lastServerContentRef.current = serverContent
        return
      }
      
      console.log('[SpecEditor] Server content changed, updating from', content.length, 'to', serverContent.length, 'chars')
      
      // Store current focus and cursor state for restoration
      const activeElement = document.activeElement
      const isEditorFocused = activeElement?.closest('.markdown-editor-container') !== null
      let cursorPosition: number | null = null
      
      if (isEditorFocused && activeElement) {
        try {
          const cmEditor = activeElement.closest('.cm-editor')
          if (cmEditor) {
            const cmView = (cmEditor as any).cmView
            if (cmView && cmView.state) {
              cursorPosition = cmView.state.selection.main.head
            }
          }
        } catch (e) {
          console.warn('[SpecEditor] Could not get cursor position:', e)
        }
      }
      
      setContent(serverContent)
      lastServerContentRef.current = serverContent
      setHasLocalChanges(false)
      
      // Restore focus and cursor position if editor was focused
      if (isEditorFocused) {
        requestAnimationFrame(() => {
          const editorElement = document.querySelector('.markdown-editor-container .cm-editor') as HTMLElement
          if (editorElement) {
            editorElement.focus()
            
            // Try to restore cursor position
            if (cursorPosition !== null) {
              try {
                const cmView = (editorElement as any).cmView
                if (cmView && cmView.state) {
                  const maxPos = cmView.state.doc.length
                  const safePos = Math.min(cursorPosition, maxPos)
                  cmView.dispatch({
                    selection: { anchor: safePos, head: safePos }
                  })
                }
              } catch (e) {
                console.warn('[SpecEditor] Could not restore cursor position:', e)
              }
            }
          }
        })
      }
    })
    
    return () => {
      console.log('[SpecEditor] Cleaning up sessions-refreshed listener for:', sessionName)
      unlistenPromise.then(unlisten => unlisten())
    }
  }, [sessionName, content, hasLocalChanges])

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
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" colorClassName="text-slate-500" size="md" />
      </div>
    )
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
{starting ? (
              <AnimatedText text="loading" colorClassName="text-slate-500" size="xs" />
            ) : (
              'Run Agent'
            )}
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
          {saving ? (
            <AnimatedText text="loading" colorClassName="text-slate-500" size="xs" centered={false} />
          ) : error ? (
            <span className="text-red-400">{error}</span>
          ) : (
            'Editing spec'
          )}
        </div>
      </div>
      
      {/* Editor */}
      <div className="flex-1 overflow-hidden">
        <Suspense fallback={
          <div className="h-full flex items-center justify-center">
            <AnimatedText text="loading" colorClassName="text-slate-500" size="md" />
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