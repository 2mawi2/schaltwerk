import { useEffect, useRef, useState, lazy, Suspense, useMemo, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscPlay } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import type { MarkdownEditorRef } from './MarkdownEditor'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'
import { useSpecContent } from '../../hooks/useSpecContent'

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
  const [displayName, setDisplayName] = useState<string | null>(null)
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const lastServerContentRef = useRef<string>('')
  const contentRef = useRef<string>('')
  const hasLocalChangesRef = useRef<boolean>(false)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const projectFileIndex = useProjectFileIndex()

  const { content: cachedContent, displayName: cachedDisplayName, hasData: hasCachedData } = useSpecContent(sessionName)
  const lastSyncedSessionRef = useRef<string | null>(null)

  useEffect(() => {
    hasLocalChangesRef.current = false
    setHasLocalChanges(false)
    setError(null)
  }, [sessionName])

  useEffect(() => {
    if (!sessionName || hasCachedData) return

    let cancelled = false
    setLoading(true)

    ;(async () => {
      try {
        const [draftContent, initialPrompt] = await invoke<[string | null, string | null]>(
          TauriCommands.SchaltwerkCoreGetSessionAgentContent,
          { name: sessionName }
        )

        if (cancelled) return

        const text = draftContent ?? initialPrompt ?? ''
        setContent(text)
        contentRef.current = text
        lastServerContentRef.current = text
        lastSyncedSessionRef.current = sessionName
        setDisplayName(sessionName)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        logger.error('Failed to load spec content:', e)
        setError(String(e))
        setLoading(false)
      }
    })()

    return () => {
      cancelled = true
    }
  }, [sessionName, hasCachedData])

  useEffect(() => {
    if (hasCachedData) {
      setLoading(false)
      setDisplayName(cachedDisplayName ?? sessionName)
    }
  }, [cachedDisplayName, hasCachedData, sessionName])

  useEffect(() => {
    if (!hasCachedData) return

    const sessionChanged = lastSyncedSessionRef.current !== sessionName
    const serverContent = cachedContent ?? ''

    if (!sessionChanged && hasLocalChangesRef.current) {
      logger.info('[SpecEditor] Skipping cached content update - local changes pending')
      return
    }

    if (!sessionChanged && serverContent === lastServerContentRef.current) {
      return
    }

    const activeElement = document.activeElement
    const isEditorFocused = activeElement?.closest('.markdown-editor-container') !== null
    let cursorPosition: number | null = null

    if (isEditorFocused && activeElement) {
      try {
        const cmEditor = activeElement.closest('.cm-editor') as HTMLElement & {
          cmView?: { state?: { selection?: { main?: { head?: number } } } }
        }
        if (cmEditor) {
          const cmView = cmEditor.cmView
          if (cmView && cmView.state) {
            cursorPosition = cmView.state.selection?.main?.head ?? null
          }
        }
      } catch (e) {
        logger.warn('[SpecEditor] Could not get cursor position:', e)
      }
    }

    setContent(serverContent)
    lastServerContentRef.current = serverContent
    lastSyncedSessionRef.current = sessionName
    setHasLocalChanges(false)
    hasLocalChangesRef.current = false

    if (isEditorFocused) {
      requestAnimationFrame(() => {
        const editorElement = document.querySelector('.markdown-editor-container .cm-editor') as HTMLElement
        if (editorElement) {
          editorElement.focus()

          if (cursorPosition !== null) {
            try {
              const cmView = (editorElement as HTMLElement & {
                cmView?: { state?: { doc?: { length?: number } }, dispatch?: (transaction: unknown) => void }
              }).cmView
              if (cmView && cmView.state) {
                const maxPos = cmView.state.doc?.length ?? 0
                const safePos = Math.min(cursorPosition, maxPos)
                cmView.dispatch?.({
                  selection: { anchor: safePos, head: safePos }
                })
              }
            } catch (e) {
              logger.warn('[SpecEditor] Could not restore cursor position:', e)
            }
          }
        }
      })
    }
  }, [cachedContent, hasCachedData, sessionName])

  // Auto-save content only when there are local changes
  useEffect(() => {
    if (!hasLocalChanges) return
    
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current)
    saveTimerRef.current = setTimeout(async () => {
      try {
        setSaving(true)
        await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, { name: sessionName, content })
        lastServerContentRef.current = content
        setHasLocalChanges(false)
      } catch (e) {
        logger.error('[DraftEditor] Failed to save spec:', e)
      } finally {
        setSaving(false)
      }
    }, 1000)
    return () => { if (saveTimerRef.current) clearTimeout(saveTimerRef.current) }
  }, [content, sessionName, hasLocalChanges])

  // Keep refs in sync with state
  useEffect(() => {
    contentRef.current = content
  }, [content])
  
  useEffect(() => {
    hasLocalChangesRef.current = hasLocalChanges
  }, [hasLocalChanges])

  const ensureProjectFiles = projectFileIndex.ensureIndex

  useEffect(() => {
    void ensureProjectFiles()
  }, [ensureProjectFiles])

  const handleContentChange = (newContent: string) => {
    setContent(newContent)
    setHasLocalChanges(true)
  }

  const handleCopy = async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(content)
    } catch (err) {
      logger.error('[DraftEditor] Failed to copy content:', err)
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
      logger.error('[DraftEditor] Failed to start spec:', e)
      setError(String(e))
    } finally {
      setStarting(false)
    }
  }, [onStart])


  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!starting && isShortcutForAction(e, KeyboardShortcutAction.RunSpecAgent, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        handleRun()
      } else if (isShortcutForAction(e, KeyboardShortcutAction.FocusClaude, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        if (markdownEditorRef.current) {
          markdownEditorRef.current.focusEnd()
          logger.info('[SpecEditor] Focused spec content via Cmd+T and moved cursor to end')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown) // Use bubble phase to not interfere with cmd+e
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleRun, starting, keyboardShortcutConfig, platform])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" size="md" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      {/* Header with read-only title */}
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">{displayName || sessionName}</h2>
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400" title="Focus spec content (⌘T)">⌘T</span>
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
              <AnimatedText text="loading" size="xs" />
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
            <AnimatedText text="loading" size="xs" centered={false} />
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
            <AnimatedText text="loading" size="md" />
          </div>
        }>
          <MarkdownEditor
            ref={markdownEditorRef}
            value={content}
            onChange={handleContentChange}
            placeholder="Enter agent description in markdown…"
            className="h-full"
            fileReferenceProvider={projectFileIndex}
          />
        </Suspense>
      </div>
    </div>
  )
}
