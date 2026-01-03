import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { DiffFileList } from './DiffFileList'
import { UnifiedDiffView } from './UnifiedDiffView'
import { ProjectFileTree } from './ProjectFileTree'
import { FileContentViewer } from './FileContentViewer'
import {
  VscScreenFull,
  VscChevronLeft,
  VscLink,
  VscComment,
  VscLinkExternal,
  VscPass,
  VscError,
  VscCircleFilled,
  VscVerified,
  VscRequestChanges,
  VscAccount,
  VscClose,
  VscGitCompare,
  VscFiles
} from 'react-icons/vsc'
import { useReview } from '../../contexts/ReviewContext'
import { useReviewComments } from '../../hooks/useReviewComments'
import { useSelection } from '../../hooks/useSelection'
import { useFocus } from '../../contexts/FocusContext'
import { useSessions } from '../../hooks/useSessions'
import { stableSessionTerminalId } from '../../common/terminalIdentity'
import { getActiveAgentTerminalId } from '../../common/terminalTargeting'
import { buildSessionScopeId } from '../../common/sessionScope'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import { useAtom } from 'jotai'
import { inlineSidebarDefaultPreferenceAtom } from '../../store/atoms/diffPreferences'
import { useShortcutDisplay } from '../../keyboardShortcuts/useShortcutDisplay'
import { KeyboardShortcutAction } from '../../keyboardShortcuts/config'
import { useClaudeSession } from '../../hooks/useClaudeSession'
import { LinkPrModal } from '../modals/LinkPrModal'
import { useToast } from '../../common/toast/ToastProvider'
import { usePrComments } from '../../hooks/usePrComments'
import { useGithubPrSearch } from '../../hooks/useGithubPrSearch'
import type { GithubPrDetails } from '../../types/githubIssues'

interface SimpleDiffPanelProps {
  mode: 'list' | 'review'
  onModeChange: (mode: 'list' | 'review') => void
  activeFile: string | null
  onActiveFileChange: (filePath: string | null) => void
  sessionNameOverride?: string
  isCommander?: boolean
  onOpenDiff?: (filePath?: string | null, forceModal?: boolean) => void
  onInlinePreferenceChange?: (value: boolean) => void
  reformatSidebarEnabled?: boolean
  onInlineLayoutPreferenceChange?: (value: boolean) => void
  onHasFilesChange?: (hasFiles: boolean) => void
}

export function SimpleDiffPanel({
  mode,
  onModeChange,
  activeFile,
  onActiveFileChange,
  sessionNameOverride,
  isCommander,
  onOpenDiff,
  onInlinePreferenceChange,
  reformatSidebarEnabled,
  onInlineLayoutPreferenceChange,
  onHasFilesChange,
}: SimpleDiffPanelProps) {
  const [hasFiles, setHasFiles] = useState(true)
  const [preferInline, setPreferInline] = useAtom(inlineSidebarDefaultPreferenceAtom)
  const [linkPrModalOpen, setLinkPrModalOpen] = useState(false)
  const [viewSource, setViewSource] = useState<'changes' | 'files'>('changes')
  const [fileViewerPath, setFileViewerPath] = useState<string | null>(null)
  const [fileTreeScrollPosition, setFileTreeScrollPosition] = useState(0)
  const { pushToast } = useToast()
  const { currentReview, getCommentsForFile, clearReview } = useReview()
  const { formatReviewForPrompt, getConfirmationMessage } = useReviewComments()
  const { selection, setSelection, terminals } = useSelection()
  const { setFocusForSession, setCurrentFocus } = useFocus()
  const { sessions, reloadSessions } = useSessions()
  const { getOrchestratorAgentType } = useClaudeSession()
  const { fetchingComments, fetchAndPasteToTerminal } = usePrComments()
  const testProps: { 'data-testid': string } = { 'data-testid': 'diff-panel' }
  const openDiffViewerShortcut = useShortcutDisplay(KeyboardShortcutAction.OpenDiffViewer)

  const currentSession = selection.kind === 'session' && typeof selection.payload === 'string'
    ? sessions.find(s => s.info.session_id === selection.payload)
    : null
  const prNumber = currentSession?.info.pr_number
  const prUrl = currentSession?.info.pr_url
  const sessionName = currentSession?.info.session_id

  const [prDetails, setPrDetails] = useState<GithubPrDetails | null>(null)
  const { fetchDetails } = useGithubPrSearch({ enabled: false })

  useEffect(() => {
    if (!prNumber) {
      setPrDetails(null)
      return
    }
    
    let mounted = true
    fetchDetails(prNumber)
        .then(details => {
            if (mounted) setPrDetails(details)
        })
        .catch(err => {
            logger.error("Failed to fetch PR details", err)
        })
    
    return () => { mounted = false }
  }, [prNumber, fetchDetails])

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
    onHasFilesChange?.(hasFiles)
  }, [hasFiles, onHasFilesChange])

  useEffect(() => {
    onInlinePreferenceChange?.(preferInline)
  }, [preferInline, onInlinePreferenceChange])

  const handleToggleLayoutPreference = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked
    onInlineLayoutPreferenceChange?.(next)
  }, [onInlineLayoutPreferenceChange])

const handleToggleInlinePreference = useCallback((event: ChangeEvent<HTMLInputElement>) => {
    const next = event.target.checked
    setPreferInline(next)
  }, [setPreferInline])

  const handleFinishReview = useCallback(async () => {
    if (!currentReview || currentReview.comments.length === 0) return

    const reviewText = formatReviewForPrompt(currentReview.comments)
    let useBracketedPaste = true
    let needsDelayedSubmit = false
    let agentType: string | undefined

    if (selection.kind === 'session') {
      const session = sessions.find(s => s.info.session_id === selection.payload)
      agentType = session?.info?.original_agent_type as string | undefined
    } else if (selection.kind === 'orchestrator') {
      try {
        agentType = await getOrchestratorAgentType()
      } catch (error) {
        logger.error('Failed to get orchestrator agent type for review submit:', error)
      }
    }

    if (agentType === 'claude' || agentType === 'droid') {
      useBracketedPaste = false
      needsDelayedSubmit = true
    }

    try {
      if (selection.kind === 'orchestrator') {
        const baseTerminalId = terminals.top || 'orchestrator-top'
        const sessionKey = buildSessionScopeId({ kind: 'orchestrator', projectPath: selection.projectPath ?? null })
        const terminalId = getActiveAgentTerminalId(sessionKey) ?? baseTerminalId
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: reviewText,
          useBracketedPaste,
          needsDelayedSubmit
        })
        await setSelection({ kind: 'orchestrator' })
        setCurrentFocus('claude')
      } else if (selection.kind === 'session' && typeof selection.payload === 'string') {
        const baseTerminalId = terminals.top || stableSessionTerminalId(selection.payload, 'top')
        const sessionKey = buildSessionScopeId({ kind: 'session', projectPath: selection.projectPath ?? null, sessionId: selection.payload })
        const terminalId = getActiveAgentTerminalId(sessionKey) ?? baseTerminalId
        await invoke(TauriCommands.PasteAndSubmitTerminal, {
          id: terminalId,
          data: reviewText,
          useBracketedPaste,
          needsDelayedSubmit
        })
        await setSelection({ kind: 'session', payload: selection.payload })
        setFocusForSession(sessionKey, 'claude')
        setCurrentFocus('claude')
      } else {
        logger.warn('[SimpleDiffPanel] Finish review triggered without valid selection context', selection)
        return
      }

      clearReview()
    } catch (error) {
      logger.error('Failed to send review to terminal from sidebar:', error)
    }
  }, [clearReview, currentReview, formatReviewForPrompt, selection, sessions, setCurrentFocus, setFocusForSession, setSelection, terminals, getOrchestratorAgentType])

  const handleCancelReview = useCallback(() => {
    clearReview()
    handleBackToList()
  }, [clearReview, handleBackToList])

  const handleLinkPrConfirm = useCallback(async (prNum: number, prUrlValue: string) => {
    if (!sessionName) return
    setLinkPrModalOpen(false)
    try {
      await invoke(TauriCommands.SchaltwerkCoreLinkSessionToPr, {
        name: sessionName,
        prNumber: prNum,
        prUrl: prUrlValue
      })
      await reloadSessions()
      pushToast({ tone: 'success', title: 'PR linked', description: `Session linked to PR #${prNum}` })
    } catch (error) {
      logger.error('Failed to link session to PR:', error)
      pushToast({ tone: 'error', title: 'Failed to link PR', description: String(error) })
    }
  }, [sessionName, reloadSessions, pushToast])

  const handleUnlinkPr = useCallback(async () => {
    if (!sessionName || !prNumber) return
    try {
      await invoke(TauriCommands.SchaltwerkCoreUnlinkSessionFromPr, {
        name: sessionName
      })
      await reloadSessions()
      pushToast({ tone: 'success', title: 'PR unlinked', description: `PR #${prNumber} unlinked from session` })
    } catch (error) {
      logger.error('Failed to unlink PR from session:', error)
      pushToast({ tone: 'error', title: 'Failed to unlink PR', description: String(error) })
    }
  }, [sessionName, prNumber, reloadSessions, pushToast])

  const handleFetchAndPasteComments = useCallback(async () => {
    if (!prNumber) return
    await fetchAndPasteToTerminal(prNumber)
  }, [prNumber, fetchAndPasteToTerminal])

  const handleViewerSelectionChange = useCallback((filePath: string | null) => {
    if (filePath !== activeFile) {
      onActiveFileChange(filePath)
    }
  }, [activeFile, onActiveFileChange])

  const renderReviewHeader = () => (
    <div className="flex items-center justify-between px-3 py-2 shrink-0 gap-2" style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}>
      <button
        onClick={handleBackToList}
        className="group pl-2 pr-3 py-1 rounded text-xs font-medium flex items-center gap-2 transition-colors"
        style={{ color: 'var(--color-text-secondary)' }}
        title={`Back to file list (${openDiffViewerShortcut || '⌘G'})`}
      >
        <VscChevronLeft className="w-4 h-4" />
        <span>Back to List</span>
        <span className="ml-1 text-[10px] opacity-50 group-hover:opacity-100 rounded px-1" style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-secondary)' }}>
          {openDiffViewerShortcut || '⌘G'}
        </span>
      </button>
      <div className="flex items-center gap-2">
        {onOpenDiff && (
          <button
            onClick={() => onOpenDiff(activeFile, true)}
            className="p-1 rounded transition-colors"
            style={{ color: 'var(--color-text-secondary)' }}
            title="Open in Modal"
          >
            <VscScreenFull />
          </button>
        )}
      </div>
    </div>
  )

  const handleProjectFileSelect = useCallback((filePath: string) => {
    setFileViewerPath(filePath)
  }, [])

  const handleBackToProjectList = useCallback(() => {
    setFileViewerPath(null)
  }, [])

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
          <div className="px-3 py-2 flex items-center justify-between gap-3 text-xs" style={{ borderTop: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}>
            <span style={{ color: 'var(--color-text-secondary)' }}>
              {getConfirmationMessage(currentReview.comments.length)}
            </span>
            <div className="flex items-center gap-2">
              <button
                onClick={handleCancelReview}
                className="px-2 py-1 rounded transition-colors"
                style={{ border: '1px solid var(--color-border-default)', color: 'var(--color-text-primary)' }}
                title="Discard pending comments"
              >
                Cancel Review
              </button>
              <button
                onClick={() => { void handleFinishReview() }}
                className="px-2 py-1 rounded text-xs font-medium transition-colors hover:opacity-90"
                style={{ backgroundColor: 'var(--color-accent-cyan)', color: 'var(--color-text-inverse)' }}
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

  const renderViewSourceToggle = () => (
    <div className="flex items-center gap-1 rounded-md p-0.5" style={{ backgroundColor: 'var(--color-bg-secondary)' }}>
      <button
        onClick={() => { setViewSource('changes'); setFileViewerPath(null) }}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors"
        style={viewSource === 'changes' ? { backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)' } : { color: 'var(--color-text-secondary)' }}
        title="Show changed files"
      >
        <VscGitCompare className="w-3 h-3" />
        <span>Changes</span>
      </button>
      <button
        onClick={() => { setViewSource('files'); setFileViewerPath(null) }}
        className="flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors"
        style={viewSource === 'files' ? { backgroundColor: 'var(--color-bg-elevated)', color: 'var(--color-text-primary)' } : { color: 'var(--color-text-secondary)' }}
        title="Browse all project files"
      >
        <VscFiles className="w-3 h-3" />
        <span>Files</span>
      </button>
    </div>
  )

  const renderFilesViewContent = () => {
    if (fileViewerPath) {
      return (
        <FileContentViewer
          filePath={fileViewerPath}
          onBack={handleBackToProjectList}
          sessionNameOverride={sessionNameOverride}
        />
      )
    }
    return (
      <ProjectFileTree
        onFileSelect={handleProjectFileSelect}
        sessionNameOverride={sessionNameOverride}
        isCommander={isCommander}
        scrollPosition={fileTreeScrollPosition}
        onScrollPositionChange={setFileTreeScrollPosition}
      />
    )
  }

  return (
    <div className="relative h-full flex flex-col overflow-hidden" {...testProps}>
      <div className="flex items-center justify-between px-3 py-2 shrink-0" style={{ borderBottom: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}>
        <div className="flex items-center gap-3">
          {renderViewSourceToggle()}
        </div>
        <div className="flex items-center gap-3">
          {viewSource === 'changes' && (
            <>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <input
                  type="checkbox"
                  className="rounded"
                  style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-bg-secondary)' }}
                  checked={preferInline}
                  onChange={handleToggleInlinePreference}
                />
                <span>Open diffs inline</span>
              </label>
              <label className="flex items-center gap-2 text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                <input
                  type="checkbox"
                  className="rounded"
                  style={{ borderColor: 'var(--color-border-default)', backgroundColor: 'var(--color-bg-secondary)' }}
                  checked={reformatSidebarEnabled ?? true}
                  onChange={handleToggleLayoutPreference}
                  disabled={!preferInline}
                />
                <span>Auto-collapse sidebar</span>
              </label>
            </>
          )}
          {viewSource === 'changes' && currentSession && (
            prNumber ? (
              <>
                {prDetails && (
                  <div className="flex items-center gap-2 mr-1 pr-2" style={{ borderRight: '1px solid var(--color-border-subtle)' }}>
                    {prDetails.statusCheckState && (
                      <div title={`CI Status: ${prDetails.statusCheckState}`} className="flex items-center">
                        {prDetails.statusCheckState === 'SUCCESS' && <VscPass className="text-green-500" />}
                        {prDetails.statusCheckState === 'FAILURE' && <VscError className="text-red-500" />}
                        {prDetails.statusCheckState === 'PENDING' && <VscCircleFilled className="text-yellow-500" />}
                      </div>
                    )}
                    {prDetails.reviewDecision && (
                      <div title={`Review: ${prDetails.reviewDecision}${prDetails.latestReviews.length > 0 ? ` by ${prDetails.latestReviews.map(r => r.author ?? 'Unknown').join(', ')}` : ''}`} className="flex items-center gap-1">
                        {prDetails.reviewDecision === 'APPROVED' && <VscVerified className="text-green-500" />}
                        {prDetails.reviewDecision === 'CHANGES_REQUESTED' && <VscRequestChanges className="text-red-500" />}
                        {prDetails.reviewDecision === 'REVIEW_REQUIRED' && <VscCircleFilled style={{ color: 'var(--color-text-tertiary)' }} />}
                        {prDetails.latestReviews.length > 0 && (
                          <span className="text-xs flex items-center gap-0.5" style={{ color: 'var(--color-text-secondary)' }}>
                            <VscAccount style={{ color: 'var(--color-text-tertiary)' }} />
                            {prDetails.latestReviews.length}
                          </span>
                        )}
                      </div>
                    )}
                  </div>
                )}
                <button
                  onClick={() => { void handleFetchAndPasteComments() }}
                  className="p-1 rounded text-blue-400 hover:text-blue-300 transition-colors disabled:opacity-50"
                  title={`Send PR #${prNumber} review comments to terminal`}
                  disabled={fetchingComments}
                >
                  <VscComment />
                </button>
                {prUrl && (
                  <button
                    onClick={() => { void invoke(TauriCommands.OpenExternalUrl, { url: prUrl }) }}
                    className="p-1 rounded text-blue-400 hover:text-blue-300 transition-colors"
                    title={`Open PR #${prNumber} in browser`}
                  >
                    <VscLinkExternal />
                  </button>
                )}
                <button
                  onClick={() => { void handleUnlinkPr() }}
                  className="p-1 rounded transition-colors"
                  style={{ color: 'var(--color-text-secondary)' }}
                  title={`Unlink PR #${prNumber} from this session`}
                >
                  <VscClose />
                </button>
              </>
            ) : (
              <button
                onClick={() => setLinkPrModalOpen(true)}
                className="p-1 rounded transition-colors"
                style={{ color: 'var(--color-text-secondary)' }}
                title="Link to GitHub PR"
              >
                <VscLink />
              </button>
            )
          )}
          {viewSource === 'changes' && onOpenDiff && (
            <button
              onClick={() => onOpenDiff(activeFile, true)}
              className="p-1 rounded transition-colors"
              style={{ color: 'var(--color-text-secondary)' }}
              title="Open in Modal"
            >
              <VscScreenFull />
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 overflow-hidden">
        {viewSource === 'changes' ? renderDiffFileList() : renderFilesViewContent()}
      </div>
      <LinkPrModal
        open={linkPrModalOpen}
        currentPrUrl={prUrl}
        onConfirm={(prNum, prUrlVal) => { void handleLinkPrConfirm(prNum, prUrlVal) }}
        onCancel={() => setLinkPrModalOpen(false)}
      />
    </div>
  )
}
