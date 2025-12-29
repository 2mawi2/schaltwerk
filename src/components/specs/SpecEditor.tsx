import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { VscCopy, VscPlay, VscEye, VscEdit, VscBeaker, VscComment } from 'react-icons/vsc'
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
import { SpecReviewEditor } from './SpecReviewEditor'
import { useSpecLineSelection } from '../../hooks/useSpecLineSelection'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { getActiveAgentTerminalId } from '../../common/terminalTargeting'
import { useReviewComments } from '../../hooks/useReviewComments'
import type { SpecReviewComment } from '../../types/specReview'
import { VscSend } from 'react-icons/vsc'

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

  const [reviewComments, setReviewComments] = useState<SpecReviewComment[]>([])
  const [showCommentForm, setShowCommentForm] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [isDraggingSelection, setIsDraggingSelection] = useState(false)
  const [commentFormPosition, setCommentFormPosition] = useState<{ x: number; y: number } | null>(null)
  const commentTextareaRef = useRef<HTMLTextAreaElement>(null)
  const lineSelection = useSpecLineSelection()
  const { getOrchestratorAgentType } = useClaudeSession()
  const { getConfirmationMessage } = useReviewComments()

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

  const focusCommentTextarea = useCallback((textarea: HTMLTextAreaElement | null) => {
    if (textarea) {
      commentTextareaRef.current = textarea
      queueMicrotask(() => {
        textarea.focus()
      })
    }
  }, [])

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

  const handleEnterReviewMode = useCallback(() => {
    setReviewComments([])
    lineSelection.clearSelection()
    setShowCommentForm(false)
    setViewMode('review')
    logger.info('[SpecEditor] Entered review mode')
  }, [lineSelection, setViewMode])

  const handleExitReviewMode = useCallback(() => {
    setReviewComments([])
    lineSelection.clearSelection()
    setShowCommentForm(false)
    setViewMode('preview')
    logger.info('[SpecEditor] Exited review mode')
  }, [lineSelection, setViewMode])

  const handleLineClick = useCallback((lineNum: number, specId: string, event?: React.MouseEvent) => {
    setIsDraggingSelection(true)
    lineSelection.handleLineClick(lineNum, specId, event)
  }, [lineSelection])

  const handleLineMouseEnter = useCallback((lineNum: number) => {
    if (isDraggingSelection && lineSelection.selection) {
      lineSelection.extendSelection(lineNum, sessionName)
    }
  }, [isDraggingSelection, lineSelection, sessionName])

  const handleLineMouseUp = useCallback(() => {
    setIsDraggingSelection(false)
    if (lineSelection.selection) {
      setCommentFormPosition({ x: 0, y: 100 })
      setShowCommentForm(true)
    }
  }, [lineSelection.selection])

  const handleSubmitComment = useCallback(() => {
    if (!lineSelection.selection || !commentText.trim()) return

    const contentLines = currentContent.split('\n')
    const selectedText = contentLines
      .slice(lineSelection.selection.startLine - 1, lineSelection.selection.endLine)
      .join('\n')

    const newComment: SpecReviewComment = {
      id: crypto.randomUUID(),
      specId: sessionName,
      lineRange: {
        start: lineSelection.selection.startLine,
        end: lineSelection.selection.endLine,
      },
      selectedText,
      comment: commentText.trim(),
      timestamp: Date.now(),
    }

    setReviewComments(prev => [...prev, newComment])
    lineSelection.clearSelection()
    setShowCommentForm(false)
    setCommentFormPosition(null)
    setCommentText('')
    logger.info('[SpecEditor] Added review comment', { lineRange: newComment.lineRange })
  }, [lineSelection, currentContent, sessionName, commentText])

  
  const handleCancelComment = useCallback(() => {
    lineSelection.clearSelection()
    setShowCommentForm(false)
    setCommentFormPosition(null)
    setCommentText('')
  }, [lineSelection])

  const formatSpecReviewForPrompt = useCallback((comments: SpecReviewComment[], specName: string, specDisplayName: string | null): string => {
    let output = '\n# Spec Review Comments\n\n'
    output += `## ${specDisplayName || specName}\n\n`

    for (const comment of comments) {
      const lineText = comment.lineRange.start === comment.lineRange.end
        ? `Line ${comment.lineRange.start}`
        : `Lines ${comment.lineRange.start}-${comment.lineRange.end}`
      output += `### ${lineText}:\n`
      output += `\`\`\`\n${comment.selectedText}\n\`\`\`\n`
      output += `**Comment:** ${comment.comment}\n\n`
    }

    return output
  }, [])

  const handleFinishReview = useCallback(async () => {
    if (reviewComments.length === 0) return

    const reviewText = formatSpecReviewForPrompt(reviewComments, sessionName, displayName)

    let useBracketedPaste = true
    let needsDelayedSubmit = false

    try {
      const agentType = await getOrchestratorAgentType()
      if (agentType === 'claude' || agentType === 'droid') {
        useBracketedPaste = false
        needsDelayedSubmit = true
      }
    } catch (err) {
      logger.error('[SpecEditor] Failed to get orchestrator agent type', err)
    }

    const terminalId = getActiveAgentTerminalId('orchestrator') ?? 'orchestrator-top'

    try {
      await invoke(TauriCommands.PasteAndSubmitTerminal, {
        id: terminalId,
        data: reviewText,
        useBracketedPaste,
        needsDelayedSubmit,
      })

      void setSelection({ kind: 'orchestrator' }, false, true)
      handleExitReviewMode()
      logger.info('[SpecEditor] Finished review, pasted to orchestrator')
    } catch (err) {
      logger.error('[SpecEditor] Failed to paste review to terminal', err)
      setError('Failed to send review to orchestrator')
    }
  }, [reviewComments, formatSpecReviewForPrompt, sessionName, displayName, getOrchestratorAgentType, setSelection, handleExitReviewMode])

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (viewMode === 'review' && e.key === 'Escape') {
        e.preventDefault()
        if (showCommentForm) {
          handleCancelComment()
        } else {
          handleExitReviewMode()
        }
        return
      }

      if (isShortcutForAction(e, KeyboardShortcutAction.SubmitDiffComment, keyboardShortcutConfig, { platform }) ||
          isShortcutForAction(e, KeyboardShortcutAction.RunSpecAgent, keyboardShortcutConfig, { platform })) {
        if (viewMode === 'review' && reviewComments.length > 0 && !showCommentForm) {
          e.preventDefault()
          e.stopPropagation()
          void handleFinishReview()
          return
        }
        if (viewMode !== 'review' && !starting) {
          e.preventDefault()
          void handleRun()
          return
        }
      }

      if (!disableFocusShortcut && isShortcutForAction(e, KeyboardShortcutAction.FocusClaude, keyboardShortcutConfig, { platform })) {
        e.preventDefault()

        if (viewMode === 'preview' || viewMode === 'review') {
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
  }, [handleRun, handleFinishReview, reviewComments.length, starting, keyboardShortcutConfig, platform, disableFocusShortcut, viewMode, sessionName, setViewMode, showCommentForm, handleCancelComment, handleExitReviewMode])

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
            showDeleteButton
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
          {viewMode !== 'review' ? (
            <>
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
                onClick={handleEnterReviewMode}
                className="px-2 py-1 rounded flex items-center gap-1 hover:opacity-90"
                style={{
                  ...specText.toolbarButton,
                  backgroundColor: theme.colors.accent.purple.bg,
                  borderWidth: 1,
                  borderStyle: 'solid',
                  borderColor: theme.colors.accent.purple.border,
                  color: theme.colors.accent.purple.DEFAULT
                }}
                title="Add comments to this spec"
              >
                <VscComment />
                Comment
              </button>
            </>
          ) : (
            <button
              onClick={handleExitReviewMode}
              className="px-2 py-1 rounded bg-slate-700 hover:bg-slate-600 text-white flex items-center gap-1"
              style={specText.toolbarButton}
              title="Exit review mode"
            >
              <VscEdit />
              Exit Review
            </button>
          )}
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
          ) : viewMode === 'review' ? (
            'Review mode — Select lines to add comments'
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
        <div style={{ display: viewMode === 'review' ? 'flex' : 'none' }} className="h-full flex-col relative">
          <div className="flex-1 min-h-0 overflow-hidden">
            <SpecReviewEditor
              content={currentContent}
              specId={sessionName}
              selection={lineSelection.selection}
              onLineClick={handleLineClick}
              onLineMouseEnter={handleLineMouseEnter}
              onLineMouseUp={handleLineMouseUp}
            />
          </div>
          {showCommentForm && lineSelection.selection && (
            <>
              <div
                className="fixed inset-0 z-[59]"
                onClick={(e) => {
                  e.stopPropagation()
                  handleCancelComment()
                }}
              />
              <div
                className="fixed right-4 bg-slate-900 border border-slate-700 rounded-lg shadow-xl p-4 w-96 z-[60]"
                style={{
                  top: commentFormPosition
                    ? Math.min(commentFormPosition.y, window.innerHeight - 300)
                    : '50%',
                  transform: commentFormPosition ? 'none' : 'translateY(-50%)',
                }}
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
                onPointerDown={(e) => e.stopPropagation()}
              >
                <div className="mb-3" style={{ color: theme.colors.text.secondary }}>
                  <div className="font-medium mb-1" style={{ fontSize: theme.fontSize.body }}>Add Review Comment</div>
                  <div style={{ fontSize: theme.fontSize.caption, color: theme.colors.text.muted }}>
                    {lineSelection.selection.startLine === lineSelection.selection.endLine
                      ? `Line ${lineSelection.selection.startLine}`
                      : `Lines ${lineSelection.selection.startLine}-${lineSelection.selection.endLine}`}
                  </div>
                </div>
                <textarea
                  ref={focusCommentTextarea}
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder="Write your comment..."
                  className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded focus:outline-none focus:border-cyan-400 resize-none"
                  style={{ fontSize: theme.fontSize.body }}
                  rows={4}
                  onKeyDown={(e) => {
                    const nativeEvent = e.nativeEvent as KeyboardEvent
                    if (isShortcutForAction(
                      nativeEvent,
                      KeyboardShortcutAction.SubmitDiffComment,
                      keyboardShortcutConfig,
                      { platform }
                    )) {
                      e.preventDefault()
                      e.stopPropagation()
                      handleSubmitComment()
                    } else if (e.key === 'Escape') {
                      e.preventDefault()
                      e.stopPropagation()
                      handleCancelComment()
                    }
                  }}
                />
                <div className="mt-3 flex justify-end gap-2">
                  <button
                    onClick={handleCancelComment}
                    className="px-3 py-1.5 bg-slate-800 hover:bg-slate-700 rounded"
                    style={{ fontSize: theme.fontSize.body }}
                  >
                    Cancel
                  </button>
                  <button
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim()}
                    className="px-3 py-1.5 bg-cyan-600 hover:bg-cyan-700 disabled:opacity-50 rounded font-medium flex items-center gap-2"
                    style={{ fontSize: theme.fontSize.body }}
                  >
                    <VscSend />
                    Submit
                  </button>
                </div>
              </div>
            </>
          )}
          {reviewComments.length > 0 && (
            <div
              className="px-3 py-2 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-3 shrink-0"
              style={{ fontSize: theme.fontSize.caption }}
            >
              <span style={{ color: theme.colors.text.muted }}>
                {getConfirmationMessage(reviewComments.length)}
              </span>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleExitReviewMode}
                  className="px-2 py-1 border border-slate-600 text-slate-200 rounded hover:bg-slate-800 transition-colors"
                  style={{ fontSize: theme.fontSize.caption }}
                  title="Discard pending comments"
                >
                  Cancel Review
                </button>
                <button
                  onClick={() => { void handleFinishReview() }}
                  className="px-2 py-1 bg-cyan-600 hover:bg-cyan-700 rounded font-medium text-white transition-colors"
                  style={{ fontSize: theme.fontSize.caption }}
                  title="Send review comments"
                >
                  Finish Review ({reviewComments.length})
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
