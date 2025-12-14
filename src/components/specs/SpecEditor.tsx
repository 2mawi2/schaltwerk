import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscPlay, VscEye, VscEdit, VscBeaker } from 'react-icons/vsc'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { MarkdownEditor, type MarkdownEditorRef } from './MarkdownEditor'
import { useProjectFileIndex } from '../../hooks/useProjectFileIndex'
import { useKeyboardShortcutsConfig } from '../../contexts/KeyboardShortcutsContext'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { detectPlatformSafe, isShortcutForAction } from '../../keyboardShortcuts/helpers'
import { useSpecContent } from '../../hooks/useSpecContent'
import { MarkdownRenderer } from './MarkdownRenderer'
import { useSelection } from '../../hooks/useSelection'
import { useSessions } from '../../hooks/useSessions'
import { useEpics } from '../../hooks/useEpics'
import { buildSpecRefineReference, runSpecRefineWithOrchestrator } from '../../utils/specRefine'
import { theme } from '../../common/theme'
import { typography } from '../../common/typography'
import { useAtom, useSetAtom } from 'jotai'
import {
  markSpecEditorSessionSavedAtom,
  specEditorContentAtomFamily,
  specEditorSavedContentAtomFamily,
  specEditorViewModeAtomFamily,
} from '../../store/atoms/specEditor'
import { EpicSelect } from '../shared/EpicSelect'

const specText = {
  title: {
    ...typography.headingLarge,
    color: theme.colors.text.primary,
    fontWeight: 600,
  },
  badge: {
    ...typography.caption,
    lineHeight: theme.lineHeight.compact,
    color: theme.colors.text.tertiary,
  },
  saving: {
    ...typography.caption,
    lineHeight: theme.lineHeight.compact,
    color: theme.colors.accent.blue.light,
  },
  toolbarButton: {
    ...typography.button,
    lineHeight: theme.lineHeight.compact,
  },
  toolbarMeta: {
    ...typography.caption,
    color: theme.colors.text.tertiary,
  },
  toolbarMetaError: {
    ...typography.caption,
    color: theme.colors.accent.red.light,
  },
}

interface Props {
  sessionName: string
  onStart?: () => void
  disableFocusShortcut?: boolean
}

export function SpecEditor({ sessionName, onStart, disableFocusShortcut = false }: Props) {
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [copying, setCopying] = useState(false)
  const [starting, setStarting] = useState(false)
  const [displayName, setDisplayName] = useState<string | null>(null)
  const markdownEditorRef = useRef<MarkdownEditorRef>(null)
  const saveCountRef = useRef(0)
  type TimeoutHandle = ReturnType<typeof setTimeout> | number
  const saveTimeoutRef = useRef<TimeoutHandle | null>(null)
  const shouldFocusAfterModeSwitch = useRef(false)
  const { config: keyboardShortcutConfig } = useKeyboardShortcutsConfig()
  const platform = useMemo(() => detectPlatformSafe(), [])
  const projectFileIndex = useProjectFileIndex()

  const { content: cachedContent, displayName: cachedDisplayName, hasData: hasCachedData } = useSpecContent(sessionName)
  const { setSelection } = useSelection()
  const { sessions, updateSessionSpecContent } = useSessions()
  const { setItemEpic } = useEpics()
  const [currentContent, setCurrentContent] = useAtom(specEditorContentAtomFamily(sessionName))
  const [viewMode, setViewMode] = useAtom(specEditorViewModeAtomFamily(sessionName))
  const markSessionSaved = useSetAtom(markSpecEditorSessionSavedAtom)
  const setSavedContent = useSetAtom(specEditorSavedContentAtomFamily(sessionName))
  const selectedEpic = useMemo(() => sessions.find(session => session.info.session_id === sessionName)?.info.epic ?? null, [sessions, sessionName])

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

    void (async () => {
      try {
        const [draftContent, initialPrompt] = await invoke<[string | null, string | null]>(
          TauriCommands.SchaltwerkCoreGetSessionAgentContent,
          { name: sessionName }
        )

        if (cancelled) return

        const text = draftContent ?? initialPrompt ?? ''
        setCurrentContent(text)
        setSavedContent(text)
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
  }, [sessionName, hasCachedData, setCurrentContent, setSavedContent])

  useEffect(() => {
    if (hasCachedData) {
      setLoading(false)
      const serverContent = cachedContent ?? ''
      setDisplayName(cachedDisplayName ?? sessionName)
      setSavedContent(serverContent)
      setCurrentContent(serverContent)
    }
  }, [cachedContent, cachedDisplayName, hasCachedData, sessionName, setCurrentContent, setSavedContent])

  useEffect(() => {
    if (!hasCachedData) return

    if (saveCountRef.current > 0) {
      logger.info('[SpecEditor] Skipping update - save in progress')
      return
    }

    const serverContent = cachedContent ?? ''
    logger.info('[SpecEditor] Updating content from server')
    setCurrentContent(serverContent)
    setSavedContent(serverContent)
  }, [cachedContent, hasCachedData, setCurrentContent, setSavedContent])

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
    saveTimeoutRef.current = window.setTimeout(() => {
      void (async () => {
        saveCountRef.current++
        try {
          await invoke(TauriCommands.SchaltwerkCoreUpdateSpecContent, {
            name: sessionName,
            content: newContent
          })
          logger.info('[SpecEditor] Spec saved automatically')
          updateSessionSpecContent(sessionName, newContent)
        } catch (e) {
          logger.error('[SpecEditor] Failed to save spec:', e)
          setError(String(e))
        } finally {
          saveCountRef.current--
          if (saveCountRef.current === 0) {
            setSaving(false)
            markSessionSaved(sessionName)
          }
        }
      })()
    }, 400)
  }

  const handleCopy = useCallback(async () => {
    try {
      setCopying(true)
      await navigator.clipboard.writeText(currentContent)
    } catch (err) {
      logger.error('[SpecEditor] Failed to copy content:', err)
    } finally {
      window.setTimeout(() => setCopying(false), 1000)
    }
  }, [currentContent])

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

  const handleRefine = useCallback(async () => {
    await runSpecRefineWithOrchestrator({
      sessionId: sessionName,
      displayName,
      selectOrchestrator: () => setSelection({ kind: 'orchestrator' }, false, true),
      logContext: '[SpecEditor]',
    })
  }, [displayName, sessionName, setSelection])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!starting && isShortcutForAction(e, KeyboardShortcutAction.RunSpecAgent, keyboardShortcutConfig, { platform })) {
        e.preventDefault()
        void handleRun()
      } else if (!disableFocusShortcut && isShortcutForAction(e, KeyboardShortcutAction.FocusClaude, keyboardShortcutConfig, { platform })) {
        e.preventDefault()

        if (viewMode === 'preview') {
          shouldFocusAfterModeSwitch.current = true
          setViewMode('edit')
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
        <AnimatedText text="loading" />
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-panel">
      <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <h2 className="truncate" style={specText.title}>{displayName || sessionName}</h2>
          <EpicSelect
            value={selectedEpic}
            onChange={(epicId) => setItemEpic(sessionName, epicId)}
          />
          {!disableFocusShortcut && (
            <span
              className="px-1.5 py-0.5 rounded bg-slate-700/50"
              style={specText.badge}
              title={viewMode === 'edit' ? 'Focus spec content' : 'Edit spec content'}
            >
              ⌘T
            </span>
          )}
          {saving && (
            <span
              className="px-1.5 py-0.5 rounded"
              style={{
                ...specText.saving,
                backgroundColor: theme.colors.accent.blue.bg,
              }}
              title="Saving..."
            >
              💾
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void handleRefine() }}
            className="px-2 py-1 rounded flex items-center gap-1 hover:opacity-90"
            style={{
              ...specText.toolbarButton,
              backgroundColor: theme.colors.accent.blue.DEFAULT,
              color: theme.colors.text.inverse
            }}
            title={buildSpecRefineReference(sessionName, displayName)}
          >
            <VscBeaker />
            Refine
          </button>
          <button
            onClick={() => setViewMode(viewMode === 'edit' ? 'preview' : 'edit')}
            className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-1"
            style={specText.toolbarButton}
            title={viewMode === 'edit' ? 'Preview markdown' : 'Edit markdown'}
          >
            {viewMode === 'edit' ? <VscEye /> : <VscEdit />}
            {viewMode === 'edit' ? 'Preview' : 'Edit'}
          </button>
          <button
            onClick={() => { void handleRun() }}
            disabled={starting}
            className="px-3 py-1 rounded bg-green-600 hover:bg-green-500 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            style={specText.toolbarButton}
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
            onClick={() => { void handleCopy() }}
            disabled={copying || !currentContent}
            className="px-2 py-1 rounded bg-blue-700 hover:bg-blue-600 text-white flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
            style={specText.toolbarButton}
            title="Copy content"
          >
            <VscCopy />
            {copying ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </div>

      <div className="px-4 py-1 border-b border-slate-800 flex items-center justify-between">
        <div style={specText.toolbarMeta}>
          {error ? (
            <span style={specText.toolbarMetaError}>{error}</span>
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
