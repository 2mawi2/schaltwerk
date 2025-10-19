import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscPlay, VscEye, VscEdit } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { MarkdownEditor, type MarkdownEditorRef } from './MarkdownEditor'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'
import { useSpecContent } from '../../hooks/useSpecContent'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useSpecEditorState } from '../../contexts/SpecEditorStateContext'

interface Props {
  sessionName: string
  onStart?: () => void
  disableFocusShortcut?: boolean
}

export function SpecEditor({ sessionName, onStart, disableFocusShortcut = false }: Props) {
  const [currentContent, setCurrentContent] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)
  const saveCountRef = useRef(0)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const shouldFocusAfterModeSwitch = useRef(false)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const projectFileIndex = useProjectFileIndex()

  const { content: cachedContent, displayName: cachedDisplayName, hasData: hasCachedData } = useSpecContent(sessionName)
  const { getViewMode, setViewMode } = useSpecEditorState()

  const viewMode = getViewMode(sessionName)

  useEffect(() => {
    setError(null)

    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
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
        setCurrentContent(text)
        setDisplayName(sessionName)
        setLoading(false)
      } catch (e) {
        if (cancelled) return
        logger.error('[SpecEditor] Failed to load spec content:', e)
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

    if (saveCountRef.current > 0) {
      logger.info('[SpecEditor] Skipping update - save in progress')
      return
    }

    const serverContent = cachedContent ?? ''
    logger.info('[SpecEditor] Updating content from server')
    setCurrentContent(serverContent)
  }, [cachedContent, hasCachedData])

  const ensureProjectFiles = projectFileIndex.ensureIndex

  useEffect(() => {
    void ensureProjectFiles()
  }, [ensureProjectFiles])

  useEffect(() => {
    if (viewMode === 'edit' && shouldFocusAfterModeSwitch.current) {
      shouldFocusAfterModeSwitch.current = false
      if (markdownEditorRef.current) {
        markdownEditorRef.current.focusEnd()
        logger.info('[SpecEditor] Focused spec content after mode switch')
      }
    }
  }, [viewMode])

  const handleContentChange = (newContent: string) => {
    setCurrentContent(newContent)

    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    setSaving(true)
    saveTimeoutRef.current = setTimeout(async () => {
      saveCountRef.current++
      try {
        await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, {
          name: sessionName,
          content: newContent
        })
        logger.info('[SpecEditor] Spec saved automatically')
      } catch (e) {
        logger.error('[SpecEditor] Failed to save spec:', e)
        setError(String(e))
      } finally {
        saveCountRef.current--
        if (saveCountRef.current === 0) {
          setSaving(false)
        }
      }
    }, 400)
  }

  const handleCopy = async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(currentContent)
    } catch (err) {
      logger.error('[SpecEditor] Failed to copy content:', err)
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
      logger.error('[SpecEditor] Failed to start spec:', e)
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
      } else if (!disableFocusShortcut && isShortcutForAction(e, KeyboardShortcutAction.FocusClaude, keyboardShortcutConfig, { platform })) {
        e.preventDefault()

        if (viewMode === 'preview') {
          shouldFocusAfterModeSwitch.current = true
          setViewMode(sessionName, 'edit')
          logger.info('[SpecEditor] Switched to edit mode via shortcut')
        } else if (markdownEditorRef.current) {
          markdownEditorRef.current.focusEnd()
          logger.info('[SpecEditor] Focused spec content via shortcut')
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleRun, starting, keyboardShortcutConfig, platform, disableFocusShortcut, viewMode, sessionName, setViewMode])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center">
        <AnimatedText text="loading" size="md" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="text-sm font-semibold text-slate-200 truncate">{displayName || sessionName}</h2>
          {!disableFocusShortcut && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-700/50 text-slate-400" title={viewMode === 'edit' ? 'Focus spec content' : 'Edit spec content'}>⌘T</span>
          )}
          {saving && (
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-blue-700/50 text-blue-400" title="Saving...">💾</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setViewMode(sessionName, viewMode === 'edit' ? 'preview' : 'edit')}
            className="px-2 py-1 text-xs rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-1"
            title={viewMode === 'edit' ? 'Preview markdown' : 'Edit markdown'}
          >
            {viewMode === 'edit' ? <VscEye /> : <VscEdit />}
            {viewMode === 'edit' ? 'Preview' : 'Edit'}
          </button>
          <button
            onClick={handleRun}
            disabled={starting}
            className="px-3 py-1 text-xs rounded bg-green-600 hover:bg-green-500 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Run agent"
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
            disabled={copying || !currentContent}
            className="px-2 py-1 text-xs rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Copy content"
          >
            <VscCopy />
            {copying ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="px-4 py-1 border-b border-slate-800 flex items-center justify-between">
        <div className="text-xs text-slate-400">
          {error ? (
            <span className="text-red-400">{error}</span>
          ) : viewMode === 'edit' ? (
            'Editing spec — Type @ to reference project files'
          ) : (
            'Preview mode'
          )}
        </div>
      </div>

      <div className="flex-1 overflow-hidden relative">
        <div style={{ display: viewMode === 'edit' ? 'block' : 'none' }} className="h-full">
          <MarkdownEditor
            ref={markdownEditorRef}
            value={currentContent}
            onChange={handleContentChange}
            placeholder="Enter agent description in markdown…"
            className="h-full"
            fileReferenceProvider={projectFileIndex}
          />
        </div>
        <div style={{ display: viewMode === 'preview' ? 'block' : 'none' }} className="h-full">
          <MarkdownRenderer content={currentContent} className="h-full" />
        </div>
      </div>
    </div>
  )
}
