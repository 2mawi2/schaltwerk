import { useState, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { VscArrowLeft, VscLinkExternal, VscRefresh, VscCheck, VscGitMerge, VscComment } from 'react-icons/vsc'
import type { GitlabMrDetails, GitlabPipelinePayload } from '../../types/gitlabTypes'
import { useTranslation } from '../../common/i18n'
import { TauriCommands } from '../../common/tauriCommands'
import { useToast } from '../../common/toast/ToastProvider'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import { GitlabLabelChip } from './GitlabLabelChip'

interface GitlabMrDetailProps {
  details: GitlabMrDetails
  onBack: () => void
  onRefreshPipeline: (sourceBranch: string, sourceProject: string, sourceHostname?: string) => Promise<GitlabPipelinePayload | null>
  sourceProject: string
  sourceHostname?: string
}

function MrStateBadge({ state }: { state: string }) {
  const { t } = useTranslation()

  let label: string
  let color: string
  let bgColor: string

  switch (state) {
    case 'merged':
      label = t.gitlabMrTab.merged
      color = 'var(--color-accent-violet)'
      bgColor = 'var(--color-accent-violet-bg)'
      break
    case 'closed':
      label = t.gitlabMrTab.closed
      color = 'var(--color-accent-red)'
      bgColor = 'var(--color-accent-red-bg)'
      break
    default:
      label = t.gitlabMrTab.opened
      color = 'var(--color-accent-green)'
      bgColor = 'var(--color-accent-green-bg)'
      break
  }

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: theme.fontSize.caption,
        fontWeight: 600,
        color,
        backgroundColor: bgColor,
        borderRadius: 9999,
        padding: '2px 8px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {label}
    </span>
  )
}

function PipelineIndicator({ status, url }: { status: string; url?: string | null }) {
  const { t } = useTranslation()

  let label: string
  let color: string

  switch (status) {
    case 'success':
      label = t.gitlabMrTab.pipelineSuccess
      color = 'var(--color-accent-green)'
      break
    case 'failed':
      label = t.gitlabMrTab.pipelineFailed
      color = 'var(--color-accent-red)'
      break
    case 'running':
      label = t.gitlabMrTab.pipelineRunning
      color = 'var(--color-accent-amber)'
      break
    default:
      label = t.gitlabMrTab.pipelinePending
      color = 'var(--color-text-muted)'
      break
  }

  const content = (
    <span className="flex items-center gap-1.5">
      <span
        style={{
          display: 'inline-block',
          width: 8,
          height: 8,
          borderRadius: 9999,
          backgroundColor: color,
          flexShrink: 0,
        }}
      />
      <span style={{ color, fontSize: theme.fontSize.caption, fontWeight: 500 }}>
        {label}
      </span>
    </span>
  )

  if (url) {
    return (
      <a
        href={url}
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1"
        onClick={(e) => {
          e.preventDefault()
          try {
            window.open(url, '_blank', 'noopener,noreferrer')
          } catch (err) {
            logger.warn('[GitlabMrDetail] Failed to open pipeline URL', err)
          }
        }}
      >
        {content}
        <VscLinkExternal className="w-2.5 h-2.5" style={{ color: 'var(--color-text-muted)' }} />
      </a>
    )
  }

  return content
}

function BranchPill({ branch }: { branch: string }) {
  return (
    <span
      style={{
        fontSize: theme.fontSize.caption,
        fontFamily: theme.fontFamily.mono,
        color: 'var(--color-text-secondary)',
        backgroundColor: 'var(--color-bg-elevated)',
        border: '1px solid var(--color-border-default)',
        borderRadius: 4,
        padding: '1px 6px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {branch}
    </span>
  )
}


function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: theme.fontSize.caption,
        fontWeight: 600,
        color: 'var(--color-text-muted)',
        marginBottom: 4,
        textTransform: 'uppercase',
        letterSpacing: '0.05em',
      }}
    >
      {children}
    </div>
  )
}

export function GitlabMrDetail({ details, onBack, onRefreshPipeline, sourceProject, sourceHostname }: GitlabMrDetailProps) {
  const { t } = useTranslation()
  const { pushToast } = useToast()
  const userNotes = details.notes.filter(n => n.body && n.body.trim().length > 0)
  const [pipelineOverride, setPipelineOverride] = useState<GitlabPipelinePayload | null>(null)
  const [refreshingPipeline, setRefreshingPipeline] = useState(false)
  const [approvePending, setApprovePending] = useState(false)
  const [mergePending, setMergePending] = useState(false)
  const [commentPending, setCommentPending] = useState(false)
  const [showCommentInput, setShowCommentInput] = useState(false)
  const [commentText, setCommentText] = useState('')
  const [squash, setSquash] = useState(false)
  const [removeSourceBranch, setRemoveSourceBranch] = useState(false)

  const effectivePipelineStatus = pipelineOverride?.status ?? details.pipelineStatus
  const effectivePipelineUrl = pipelineOverride?.url ?? details.pipelineUrl

  const handleOpenInGitlab = () => {
    try {
      window.open(details.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      logger.warn('[GitlabMrDetail] Failed to open URL', err)
    }
  }

  const handleRefreshPipeline = useCallback(async () => {
    setRefreshingPipeline(true)
    try {
      const pipeline = await onRefreshPipeline(details.sourceBranch, sourceProject, sourceHostname)
      if (pipeline) {
        setPipelineOverride(pipeline)
      }
    } catch (err) {
      logger.warn('[GitlabMrDetail] Failed to refresh pipeline', err)
    } finally {
      setRefreshingPipeline(false)
    }
  }, [details.sourceBranch, sourceProject, sourceHostname, onRefreshPipeline])

  const handleApprove = useCallback(async () => {
    setApprovePending(true)
    try {
      await invoke(TauriCommands.GitLabApproveMr, {
        iid: details.iid,
        sourceProject,
        sourceHostname: sourceHostname ?? null,
      })
      pushToast({ tone: 'success', title: t.gitlabMrTab.approveSuccess })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('[GitlabMrDetail] Failed to approve MR', error)
      pushToast({ tone: 'error', title: t.gitlabMrTab.approveFailed, description: message })
    } finally {
      setApprovePending(false)
    }
  }, [sourceProject, details.iid, sourceHostname, pushToast, t])

  const handleMerge = useCallback(async () => {
    setMergePending(true)
    try {
      await invoke(TauriCommands.GitLabMergeMr, {
        iid: details.iid,
        sourceProject,
        sourceHostname: sourceHostname ?? null,
        squash,
        removeSourceBranch,
      })
      pushToast({ tone: 'success', title: t.gitlabMrTab.mergeSuccess })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('[GitlabMrDetail] Failed to merge MR', error)
      pushToast({ tone: 'error', title: t.gitlabMrTab.mergeFailed, description: message })
    } finally {
      setMergePending(false)
    }
  }, [sourceProject, details.iid, sourceHostname, squash, removeSourceBranch, pushToast, t])

  const handleComment = useCallback(async () => {
    if (!commentText.trim()) return
    setCommentPending(true)
    try {
      await invoke(TauriCommands.GitLabCommentOnMr, {
        iid: details.iid,
        sourceProject,
        sourceHostname: sourceHostname ?? null,
        message: commentText,
      })
      pushToast({ tone: 'success', title: t.gitlabMrTab.commentSuccess })
      setCommentText('')
      setShowCommentInput(false)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('[GitlabMrDetail] Failed to comment on MR', error)
      pushToast({ tone: 'error', title: t.gitlabMrTab.commentFailed, description: message })
    } finally {
      setCommentPending(false)
    }
  }, [sourceProject, details.iid, commentText, sourceHostname, pushToast, t])

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-default)' }}
      >
        <button
          type="button"
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-secondary)',
            backgroundColor: 'transparent',
          }}
          title={t.gitlabMrTab.back}
        >
          <VscArrowLeft className="w-3.5 h-3.5" />
          <span>{t.gitlabMrTab.back}</span>
        </button>

        <div className="flex-1" />

        <button
          type="button"
          onClick={handleOpenInGitlab}
          className="flex items-center gap-1 px-2 py-1 rounded"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-blue)',
            backgroundColor: 'transparent',
          }}
          title={t.gitlabMrTab.openInGitlab}
        >
          <VscLinkExternal className="w-3 h-3" />
          <span>{t.gitlabMrTab.openInGitlab}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-start gap-2 mb-3 flex-wrap">
          <MrStateBadge state={details.state} />
          <span
            style={{
              fontSize: theme.fontSize.caption,
              color: 'var(--color-text-muted)',
              backgroundColor: 'var(--color-bg-elevated)',
              borderRadius: 9999,
              padding: '2px 8px',
              lineHeight: theme.lineHeight.badge,
            }}
          >
            {details.sourceLabel}
          </span>
        </div>

        <h3
          style={{
            fontSize: theme.fontSize.body,
            fontWeight: 600,
            color: 'var(--color-text-primary)',
            marginBottom: 8,
            fontFamily: theme.fontFamily.sans,
            lineHeight: theme.lineHeight.body,
          }}
        >
          !{details.iid} {details.title}
        </h3>

        <div className="flex items-center gap-2 mb-3 flex-wrap">
          <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
            {t.gitlabMrTab.sourceBranch}:
          </span>
          <BranchPill branch={details.sourceBranch} />
          <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
            &rarr;
          </span>
          <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
            {t.gitlabMrTab.targetBranch}:
          </span>
          <BranchPill branch={details.targetBranch} />
        </div>

        {effectivePipelineStatus && (
          <div className="flex items-center gap-2 mb-3">
            <SectionLabel>{t.gitlabMrTab.pipeline}</SectionLabel>
            <PipelineIndicator status={effectivePipelineStatus} url={effectivePipelineUrl} />
            <button
              type="button"
              onClick={() => { void handleRefreshPipeline() }}
              disabled={refreshingPipeline}
              className="flex items-center gap-1 px-1.5 py-0.5 rounded"
              style={{
                fontSize: theme.fontSize.caption,
                color: refreshingPipeline ? 'var(--color-text-muted)' : 'var(--color-text-secondary)',
                backgroundColor: 'transparent',
              }}
              title={t.gitlabMrTab.refreshPipeline}
            >
              <VscRefresh className={`w-3 h-3 ${refreshingPipeline ? 'animate-spin' : ''}`} />
            </button>
          </div>
        )}

        {details.mergeStatus && (
          <div className="mb-3">
            <SectionLabel>{t.gitlabMrTab.mergeStatus}</SectionLabel>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-secondary)' }}>
              {details.mergeStatus}
            </span>
          </div>
        )}

        {details.reviewers.length > 0 ? (
          <div className="mb-3">
            <SectionLabel>{t.gitlabMrTab.reviewers}</SectionLabel>
            <div className="flex flex-wrap gap-1">
              {details.reviewers.map(reviewer => (
                <span
                  key={reviewer}
                  style={{
                    fontSize: theme.fontSize.caption,
                    color: 'var(--color-text-secondary)',
                    backgroundColor: 'var(--color-bg-elevated)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 4,
                    padding: '1px 6px',
                    lineHeight: theme.lineHeight.badge,
                  }}
                >
                  {reviewer}
                </span>
              ))}
            </div>
          </div>
        ) : (
          <div className="mb-3">
            <SectionLabel>{t.gitlabMrTab.reviewers}</SectionLabel>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', fontStyle: 'italic' }}>
              {t.gitlabMrTab.noReviewers}
            </span>
          </div>
        )}

        {details.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {details.labels.map(label => (
              <GitlabLabelChip key={label} label={label} />
            ))}
          </div>
        )}

        {details.description && (
          <div className="mb-4">
            <SectionLabel>{t.gitlabMrTab.description}</SectionLabel>
            <div
              style={{
                fontSize: theme.fontSize.body,
                color: 'var(--color-text-secondary)',
                lineHeight: theme.lineHeight.body,
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-word',
                fontFamily: theme.fontFamily.sans,
                backgroundColor: 'var(--color-bg-tertiary)',
                borderRadius: 6,
                padding: '8px 10px',
                border: '1px solid var(--color-border-default)',
              }}
            >
              {details.description}
            </div>
          </div>
        )}

        <div>
          <SectionLabel>
            {t.gitlabMrTab.notes} ({userNotes.length})
          </SectionLabel>

          {userNotes.length === 0 ? (
            <div
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {t.gitlabMrTab.noNotes}
            </div>
          ) : (
            <div className="space-y-2">
              {userNotes.map((note, idx) => (
                <div
                  key={idx}
                  style={{
                    backgroundColor: 'var(--color-bg-tertiary)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    border: '1px solid var(--color-border-default)',
                  }}
                >
                  <div
                    className="flex items-center gap-2 mb-1"
                    style={{
                      fontSize: theme.fontSize.caption,
                      color: 'var(--color-text-muted)',
                    }}
                  >
                    {note.author && (
                      <span style={{ fontWeight: 600, color: 'var(--color-text-secondary)' }}>
                        {note.author}
                      </span>
                    )}
                    <span>{formatRelativeDate(note.createdAt)}</span>
                  </div>
                  <div
                    style={{
                      fontSize: theme.fontSize.body,
                      color: 'var(--color-text-secondary)',
                      lineHeight: theme.lineHeight.body,
                      whiteSpace: 'pre-wrap',
                      wordBreak: 'break-word',
                      fontFamily: theme.fontFamily.sans,
                    }}
                  >
                    {note.body}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {details.state === 'opened' && (
          <div
            className="mt-4 pt-3 flex flex-col gap-2"
            style={{ borderTop: '1px solid var(--color-border-default)' }}
          >
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => { void handleApprove() }}
                disabled={approvePending}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                style={{
                  fontSize: theme.fontSize.caption,
                  fontFamily: theme.fontFamily.sans,
                  color: approvePending ? 'var(--color-text-muted)' : 'var(--color-accent-green)',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--color-border-default)',
                  cursor: approvePending ? 'default' : 'pointer',
                  opacity: approvePending ? 0.6 : 1,
                }}
              >
                <VscCheck className="w-3.5 h-3.5" />
                <span>{approvePending ? t.gitlabMrTab.approving : t.gitlabMrTab.approve}</span>
              </button>

              {details.mergeStatus === 'can_be_merged' && (
                <button
                  type="button"
                  onClick={() => { void handleMerge() }}
                  disabled={mergePending}
                  className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: mergePending ? 'var(--color-text-muted)' : 'var(--color-accent-violet)',
                    backgroundColor: 'transparent',
                    border: '1px solid var(--color-border-default)',
                    cursor: mergePending ? 'default' : 'pointer',
                    opacity: mergePending ? 0.6 : 1,
                  }}
                >
                  <VscGitMerge className="w-3.5 h-3.5" />
                  <span>{mergePending ? t.gitlabMrTab.merging : t.gitlabMrTab.merge}</span>
                </button>
              )}

              <button
                type="button"
                onClick={() => setShowCommentInput(prev => !prev)}
                className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                style={{
                  fontSize: theme.fontSize.caption,
                  fontFamily: theme.fontFamily.sans,
                  color: showCommentInput ? 'var(--color-accent-blue)' : 'var(--color-text-secondary)',
                  backgroundColor: 'transparent',
                  border: '1px solid var(--color-border-default)',
                  cursor: 'pointer',
                }}
              >
                <VscComment className="w-3.5 h-3.5" />
                <span>{t.gitlabMrTab.comment}</span>
              </button>
            </div>

            {details.mergeStatus === 'can_be_merged' && (
              <div className="flex items-center gap-3">
                <label
                  className="flex items-center gap-1.5"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={squash}
                    onChange={(e) => setSquash(e.target.checked)}
                    style={{ accentColor: 'var(--color-accent-blue)' }}
                  />
                  {t.gitlabMrTab.squashCommits}
                </label>

                <label
                  className="flex items-center gap-1.5"
                  style={{
                    fontSize: theme.fontSize.caption,
                    fontFamily: theme.fontFamily.sans,
                    color: 'var(--color-text-secondary)',
                    cursor: 'pointer',
                  }}
                >
                  <input
                    type="checkbox"
                    checked={removeSourceBranch}
                    onChange={(e) => setRemoveSourceBranch(e.target.checked)}
                    style={{ accentColor: 'var(--color-accent-blue)' }}
                  />
                  {t.gitlabMrTab.removeSourceBranch}
                </label>
              </div>
            )}

            {showCommentInput && (
              <div className="flex flex-col gap-2 mt-1">
                <textarea
                  value={commentText}
                  onChange={(e) => setCommentText(e.target.value)}
                  placeholder={t.gitlabMrTab.commentPlaceholder}
                  rows={3}
                  style={{
                    fontSize: theme.fontSize.body,
                    fontFamily: theme.fontFamily.sans,
                    color: 'var(--color-text-primary)',
                    backgroundColor: 'var(--color-bg-tertiary)',
                    border: '1px solid var(--color-border-default)',
                    borderRadius: 6,
                    padding: '8px 10px',
                    resize: 'vertical',
                    lineHeight: theme.lineHeight.body,
                    outline: 'none',
                  }}
                />
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => { void handleComment() }}
                    disabled={commentPending || !commentText.trim()}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                    style={{
                      fontSize: theme.fontSize.caption,
                      fontFamily: theme.fontFamily.sans,
                      color: commentPending || !commentText.trim() ? 'var(--color-text-muted)' : 'var(--color-accent-blue)',
                      backgroundColor: 'transparent',
                      border: '1px solid var(--color-border-default)',
                      cursor: commentPending || !commentText.trim() ? 'default' : 'pointer',
                      opacity: commentPending || !commentText.trim() ? 0.6 : 1,
                    }}
                  >
                    <span>{commentPending ? t.gitlabMrTab.commenting : t.gitlabMrTab.send}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => { setShowCommentInput(false); setCommentText('') }}
                    className="flex items-center gap-1.5 px-2.5 py-1 rounded"
                    style={{
                      fontSize: theme.fontSize.caption,
                      fontFamily: theme.fontFamily.sans,
                      color: 'var(--color-text-muted)',
                      backgroundColor: 'transparent',
                      border: '1px solid var(--color-border-default)',
                      cursor: 'pointer',
                    }}
                  >
                    <span>{t.gitlabMrTab.cancel}</span>
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
