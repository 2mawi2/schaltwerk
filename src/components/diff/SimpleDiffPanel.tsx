import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { DiffFileList } from './DiffFileList'
import { UnifiedDiffView } from './UnifiedDiffView'
import { VscScreenFull, VscChevronLeft } from 'react-icons/vsc'
import { useReview } from '../../contexts/ReviewContext'
import { useReviewComments } from '../../hooks/useReviewComments'
import { useSelection } from '../../hooks/useSelection'
import { useFocus } from '../../contexts/FocusContext'
import { useSessions } from '../../hooks/useSessions'
import { stableSessionTerminalId } from '../../common/terminalIdentity'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import { theme } from '../../common/theme'
import { useAtom } from 'jotai'
import { inlineSidebarDefaultPreferenceAtom } from '../../store/atoms/diffPreferences'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'

interface SimpleDiffPanelProps {
  mode: 'list' | 'review'
  onModeChange: (mode: 'list' | 'review') => void
  activeFile: string | null
  onActiveFileChange: (filePath: string | null) => void
  sessionNameOverride?: string
  isCommander?: boolean
  onOpenDiff?: (filePath?: string | null, forceModal?: boolean) => void
  onInlinePreferenceChange?: (value: boolean) => void
}

export function SimpleDiffPanel({
  mode,
  onModeChange,
  activeFile,
  onActiveFileChange,
  sessionNameOverride,
  isCommander,
  onOpenDiff,
  onInlinePreferenceChange
}: SimpleDiffPanelProps) {
  const [hasFiles, setHasFiles] = useState(true)
  const [preferInline, setPreferInline] = useAtom(inlineSidebarDefaultPreferenceAtom)
  const { currentReview, getCommentsForFile, clearReview } = useReview()
  const { formatReviewForPrompt, getConfirmationMessage } = useReviewComments()
  const { selection, setSelection, terminals } = useSelection()
  const { setFocusForSession, setCurrentFocus } = useFocus()
  const { sessions } = useSessions()
  const testProps: { 'data-testid': string } = { 'data-testid': 'diff-panel' }
  const openDiffViewerShortcut = useShortcutDisplay(KeyboardShortcutAction.OpenDiffViewer)

  const handleSelectFile = useCallback((filePath: string) => {
    onActiveFileChange(filePath)
    if (preferInline) {
      onModeChange('review')
    } else {
      onOpenDiff?.(filePath)
    }
  }, [preferInline, onActiveFileChange, onModeChange, onOpenDiff])

  const handleBackToList = useCallback(() => {
    onActiveFileChange(null)
    onModeChange('list')
  }, [onActiveFileChange, onModeChange])

  useEffect(() => {
    if (mode === 'review' && !hasFiles) {
      handleBackToList()
    }
  }, [mode, hasFiles, handleBackToList])

  useEffect(() => {
    onInlinePreferenceChange?.(preferInline)
  }, [preferInline, onInlinePreferenceChange])

const handleToggleInlinePreference = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked
    setPreferInline(next)
  }, [setPreferInline])

  const handleFinishReview = useCallback(async () => {
    if (!currentReview || currentReview.comments.length === 0) return

    const reviewText = formatReviewForPrompt(currentReview.comments)
    let useBracketedPaste = true
    let needsDelayedSubmit = false

    if (selection.kind === 'session') {
      const session = sessions.find(s => s.info.session_id === selection.payload)
      const agentType = session?.info?.original_agent_type as string | undefined
      if (agentType === 'claude' || agentType === 'droid') {
        useBracketedPaste = false
        needsDelayedSubmit = true
      }
    }

    try {
      if (selection.kind === 'orchestrator') {
        const terminalId = terminals.top || 'orchestrator-top'
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: reviewText,
          useBracketedPaste,
          needsDelayedSubmit
        })
        await setSelection({ kind: 'orchestrator' })
        setCurrentFocus('claude')
      } else if (selection.kind === 'session' && typeof selection.payload === 'string') {
        const terminalId = stableSessionTerminalId(selection.payload, 'top')
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: reviewText,
          useBracketedPaste,
          needsDelayedSubmit
        })
        await setSelection({ kind: 'session', payload: selection.payload })
        setFocusForSession(selection.payload, 'claude')
        setCurrentFocus('claude')
      } else {
        logger.warn('[SimpleDiffPanel] Finish review triggered without valid selection context', selection)
        return
      }

      clearReview()
    } catch (error) {
      logger.error('Failed to send review to terminal from sidebar:', error)
    }
  }, [clearReview, currentReview, formatReviewForPrompt, selection, sessions, setCurrentFocus, setFocusForSession, setSelection, terminals])

  const handleCancelReview = useCallback(() => {
    clearReview()
    handleBackToList()
  }, [clearReview, handleBackToList])

  const handleViewerSelectionChange = useCallback((filePath: string | null) => {
    if (filePath !== activeFile) {
      onActiveFileChange(filePath)
    }
  }, [activeFile, onActiveFileChange])

  const renderReviewHeader = () => (
    <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950 shrink-0 gap-2">
      <button
        onClick={handleBackToList}
        className="group pl-2 pr-3 py-1 rounded text-xs font-medium flex items-center gap-2 text-slate-400 hover:text-slate-200 hover:bg-slate-800/50 transition-colors"
        title={`Back to file list (${openDiffViewerShortcut || '⌘G'})`}
      >
        <VscChevronLeft className="w-4 h-4" />
        <span>Back to List</span>
        <span className="ml-1 text-[10px] opacity-50 group-hover:opacity-100 border border-slate-700/50 rounded px-1 bg-slate-800/50">
          {openDiffViewerShortcut || '⌘G'}
        </span>
      </button>
      <div className="flex items-center gap-2">
        {onOpenDiff && (
          <button
            onClick={() => onOpenDiff(activeFile, true)}
            className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
            title="Open in Modal"
          >
            <VscScreenFull />
          </button>
        )}
      </div>
    </div>
  )

  const renderDiffFileList = () => (
    <DiffFileList
      onFileSelect={handleSelectFile}
      sessionNameOverride={sessionNameOverride}
      isCommander={isCommander}
      getCommentCountForFile={(path) => getCommentsForFile(path).length}
      selectedFilePath={activeFile}
      onFilesChange={setHasFiles}
    />
  )

  if (mode === 'review') {
    return (
      <div className="relative h-full flex flex-col overflow-hidden" {...testProps}>
        {renderReviewHeader()}
        <div className="flex-1 min-h-0 overflow-hidden">
          <UnifiedDiffView
            filePath={activeFile}
            isOpen={true}
            onClose={handleBackToList}
            viewMode="sidebar"
            className="h-full"
            onSelectedFileChange={handleViewerSelectionChange}
          />
        </div>
        {currentReview && currentReview.comments.length > 0 && (
          <div className="px-3 py-2 border-t border-slate-800 bg-slate-950 flex items-center justify-between gap-3 text-xs">
            <span className="text-slate-400">
              {getConfirmationMessage(currentReview.comments.length)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancelReview}
                className="px-2 py-1 border border-slate-600 text-slate-200 rounded hover:bg-slate-800 transition-colors"
                title="Discard pending comments"
              >
                Cancel Review
              </button>
              <button
                onClick={() => { void handleFinishReview() }}
                className="px-2 py-1 bg-cyan-600 hover:bg-cyan-700 rounded text-xs font-medium text-white transition-colors"
                title="Send review comments"
              >
                Finish Review ({currentReview.comments.length})
              </button>
            </div>
          </div>
        )}
        <div style={{ display: 'none' }} aria-hidden="true">
          {renderDiffFileList()}
        </div>
      </div>
    )
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden" {...testProps}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-slate-800 bg-slate-950 shrink-0">
        <span className="text-xs font-medium text-slate-400">Changed Files</span>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-xs" style={{ color: theme.colors.text.secondary }}>
            <input
              type="checkbox"
              className="rounded border-slate-600 bg-slate-900"
              checked={preferInline}
              onChange={handleToggleInlinePreference}
            />
            <span>Open diffs inline</span>
          </label>
          {onOpenDiff && (
            <button
              onClick={() => onOpenDiff(activeFile, true)}
              className="p-1 hover:bg-slate-800 rounded text-slate-400 hover:text-slate-200 transition-colors"
              title="Open in Modal"
            >
              <VscScreenFull />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {renderDiffFileList()}
      </div>
    </div>
  )
}
