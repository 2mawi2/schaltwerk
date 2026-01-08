import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useGithubIssueSearch } from '../../hooks/useGithubIssueSearch'
import { useToast } from '../../common/toast/ToastProvider'
import { MarkdownRenderer } from '../specs/MarkdownRenderer'
import type { GithubIssueSelectionResult, GithubIssueSummary } from '../../types/githubIssues'
import { TauriCommands } from '../../common/tauriCommands'
import { withOpacity } from '../../common/colorUtils'
import { buildIssuePreview, buildIssuePrompt, formatIssueUpdatedTimestamp } from './githubIssueFormatting'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n'

interface Props {
  selection: GithubIssueSelectionResult | null
  onIssueLoaded: (selection: GithubIssueSelectionResult) => void
  onClearSelection: () => void
  onLoadingChange: (loading: boolean) => void
}

export function GitHubIssuePromptSection({
  selection,
  onIssueLoaded,
  onClearSelection,
  onLoadingChange,
}: Props) {
  const { t } = useTranslation()
  const github = useGithubIntegrationContext()
  const { pushToast } = useToast()
  const isCliInstalled = github.status?.installed ?? !github.isGhMissing
  const isAuthenticated = github.status?.authenticated ?? false
  const hasRepository = github.hasRepository
  const integrationReady = isCliInstalled && isAuthenticated && hasRepository
  const { results, loading, error, query, setQuery, fetchDetails, clearError } =
    useGithubIssueSearch({ enabled: integrationReady })
  const [activeIssue, setActiveIssue] = useState<number | null>(null)
  const [hoveredIssue, setHoveredIssue] = useState<number | null>(null)
  const renderLabelChips = (
    labels: Array<{ name: string; color?: string | null }>,
    options: { compact?: boolean } = {}
  ) => {
    if (!labels.length) {
      return null
    }

    const marginTop = options.compact ? '-0.125rem' : '0.25rem'

    return (
      <div
        className="flex flex-wrap gap-2"
        style={{ marginTop }}
      >
        {labels.map(label => {
          const isFallback = !label.color
          const baseHex = label.color ? `#${label.color}` : 'var(--color-accent-blue)'
          const borderColor = isFallback ? 'var(--color-accent-blue-border)' : withOpacity(baseHex, 0.4)
          const backgroundColor = isFallback ? 'var(--color-accent-blue-bg)' : withOpacity(baseHex, 0.16)
          return (
            <span
              key={label.name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.25rem 0.5rem',
                borderRadius: theme.borderRadius.full,
                border: `1px solid ${borderColor}`,
                backgroundColor,
                color: baseHex,
                fontSize: theme.fontSize.caption,
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              {label.name}
            </span>
          )
        })}
      </div>
    )
  }

  useEffect(() => {
    if (integrationReady) {
      return
    }
    setHoveredIssue(null)
  }, [integrationReady])

  useEffect(() => {
    if (error) {
      pushToast({
        tone: 'error',
        title: t.githubIssue.searchFailed,
        description: error,
      })
      clearError()
    }
  }, [error, pushToast, clearError, t])

  const handleIssueClick = useCallback(
    async (summary: GithubIssueSummary) => {
      onLoadingChange(true)
      setActiveIssue(summary.number)
      try {
        const details = await fetchDetails(summary.number)
        const prompt = buildIssuePrompt(details)
        onIssueLoaded({ details, prompt })
      } catch (err) {
        logger.error(`Failed to load GitHub issue details for #${summary.number}`, err)
        pushToast({
          tone: 'error',
          title: t.githubIssue.failedToLoadDetails,
          description: err instanceof Error ? err.message : String(err),
        })
      } finally {
        onLoadingChange(false)
        setActiveIssue(null)
      }
    },
    [fetchDetails, onIssueLoaded, onLoadingChange, pushToast]
  )

  const handleOpenLink = useCallback(
    async (url: string) => {
      try {
        await invoke<void>(TauriCommands.OpenExternalUrl, { url })
      } catch (error) {
        if (typeof window !== 'undefined') {
          const handle = window.open(url, '_blank', 'noopener,noreferrer')
          if (handle) {
            return
          }
        }
        pushToast({
          tone: 'error',
          title: t.githubIssue.failedToOpenLink,
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [pushToast, t]
  )

  const previewMarkdown = useMemo(() => {
    if (!selection) {
      return ''
    }
    return buildIssuePreview(selection.details)
  }, [selection])

  const selectedSummary = selection
    ? results.find(item => item.number === selection.details.number)
    : undefined
  const selectedIssueNumber = selection?.details.number ?? null

  if (selection) {
    const { details } = selection
    const state = (selectedSummary?.state ?? 'open').toLowerCase()
    const statusTone = state === 'open' ? 'green' : 'red'
    const updatedDisplay = selectedSummary ? formatIssueUpdatedTimestamp(selectedSummary) : null
    const commentCount = details.comments.length
    const commentLabel =
      commentCount === 0
        ? t.githubIssue.noCommentsYet
        : `${commentCount} ${commentCount === 1 ? t.githubIssue.comment : t.githubIssue.comments}`
    const metaParts = [`#${details.number}`, commentLabel]
    if (updatedDisplay) {
      metaParts.unshift(t.githubIssue.updated.replace('{time}', updatedDisplay))
    }

    return (
      <div
        className="flex flex-col h-full border rounded"
        style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-elevated)' }}
      >
        <div
          className="flex items-start justify-between gap-4 border-b"
          style={{
            borderColor: 'var(--color-border-subtle)',
            padding: '16px 18px',
          }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
              <span
                style={{
                  fontSize: theme.fontSize.headingLarge,
                  fontWeight: 600,
                  color: 'var(--color-text-primary)',
                }}
              >
                {details.title}
              </span>
              <span
                style={{
                  fontSize: theme.fontSize.caption,
                  fontWeight: 600,
                  padding: '0.25rem 0.75rem',
                  borderRadius: theme.borderRadius.full,
                  backgroundColor: `var(--color-accent-${statusTone}-bg)`,
                  color: `var(--color-accent-${statusTone})`,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {state === 'open' ? t.githubIssue.open : t.githubIssue.closed}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-tertiary)',
              }}
            >
              {metaParts.map((part, index) => (
                <span key={part}>
                  {part}
                  {index < metaParts.length - 1 ? ' ·' : ''}
                </span>
              ))}
            </div>

            {renderLabelChips(details.labels)}
          </div>
          <div className="flex flex-shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={() => { void handleOpenLink(details.url) }}
              className="px-2 py-1 text-xs rounded border transition-colors"
              style={{
                backgroundColor: 'var(--color-accent-blue-bg)',
                border: '1px solid var(--color-accent-blue-border)',
                color: 'var(--color-accent-blue)',
                padding: '0.5rem 0.75rem',
                fontSize: theme.fontSize.button,
              }}
            >
              {t.githubIssue.viewOnGithub}
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="px-2 py-1 text-xs rounded border transition-colors"
              style={{
                backgroundColor: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border-subtle)',
                color: 'var(--color-text-secondary)',
              }}
            >
              {t.githubIssue.clearSelection}
            </button>
          </div>
        </div>
        <div
          className="flex-1 overflow-auto"
          style={{
            padding: '18px',
          }}
        >
          <div
            style={{
              borderRadius: theme.borderRadius.lg,
              border: '1px solid var(--color-border-subtle)',
              backgroundColor: 'var(--color-bg-primary)',
              padding: '16px',
            }}
          >
            <MarkdownRenderer content={previewMarkdown} className="h-full" />
          </div>
        </div>
      </div>
    )
  }

  if (!integrationReady) {
    return (
      <div
        className="flex flex-col gap-3 p-4 border rounded"
        style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-elevated)' }}
      >
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t.githubIssue.searchPlaceholder}
          disabled
          className="px-3 py-2 rounded text-sm"
          style={{
            backgroundColor: 'var(--color-bg-primary)',
            color: 'var(--color-text-secondary)',
            border: '1px solid var(--color-border-subtle)',
            opacity: 0.6,
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full border rounded"
      style={{ borderColor: 'var(--color-border-subtle)', backgroundColor: 'var(--color-bg-elevated)' }}
    >
      <div className="p-3 border-b space-y-2" style={{ borderColor: 'var(--color-border-subtle)' }}>
        <p className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
          {t.githubIssue.searchHint}
        </p>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder={t.githubIssue.searchPlaceholder}
          aria-label={t.githubIssue.searchPlaceholder}
          className="w-full px-3 py-2 text-sm rounded"
          style={{
            backgroundColor: 'var(--color-bg-primary)',
            color: 'var(--color-text-primary)',
            border: '1px solid var(--color-border-default)',
            boxShadow: '0 0 0 1px transparent',
          }}
          onFocus={event => {
            event.currentTarget.style.boxShadow = '0 0 0 1px var(--color-accent-blue)';
          }}
          onBlur={event => {
            event.currentTarget.style.boxShadow = '0 0 0 1px transparent';
          }}
        />
      </div>
      <div className="flex-1 overflow-auto">
        {loading ? (
          <div
            className="flex flex-col items-center justify-center gap-2 py-10 text-sm"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <span
              className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: 'var(--color-accent-blue)' }}
            />
            {t.githubIssue.loadingIssues}
          </div>
        ) : results.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-center"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <span role="img" aria-hidden="true">🔍</span>
            <span>{t.githubIssue.noIssuesFound}</span>
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              {t.githubIssue.adjustSearch}
            </span>
          </div>
        ) : (
          <ul className="p-2 space-y-2">
            {results.map(issue => {
              const isLoading = activeIssue === issue.number
              const isHovered = hoveredIssue === issue.number
              const isSelected = selectedIssueNumber === issue.number
              const state = issue.state.toLowerCase()
              const statusTone = state === 'open' ? 'green' : 'red'
              const baseBackground = 'var(--color-bg-primary)'
              const backgroundColor = isSelected
                ? 'var(--color-accent-blue-bg)'
                : isHovered
                  ? 'var(--color-bg-hover)'
                  : baseBackground
              const borderColor = isSelected
                ? 'var(--color-accent-blue)'
                : isHovered
                  ? 'var(--color-border-strong)'
                  : 'var(--color-border-subtle)'

              const metadata: string[] = [
                t.githubIssue.updated.replace('{time}', formatIssueUpdatedTimestamp(issue)),
                `#${issue.number}`,
              ]

              if (issue.author) {
                metadata.push(t.githubIssue.openedBy.replace('{author}', issue.author))
              }

              const statusLabel = state.charAt(0).toUpperCase() + state.slice(1)

              return (
                <li key={issue.number}>
                  <button
                    type="button"
                    onClick={() => { void handleIssueClick(issue) }}
                    onMouseEnter={() => setHoveredIssue(issue.number)}
                    onMouseLeave={() => setHoveredIssue(current => (current === issue.number ? null : current))}
                    disabled={isLoading}
                    aria-label={`Use GitHub issue ${issue.number}: ${issue.title}`}
                    data-testid={`github-issue-result-${issue.number}`}
                    className="w-full text-left"
                    style={{
                      backgroundColor,
                      color: 'var(--color-text-primary)',
                      border: `1px solid ${borderColor}`,
                      borderRadius: theme.borderRadius.lg,
                      padding: '14px 16px',
                      cursor: isLoading ? 'wait' : 'pointer',
                      opacity: isLoading ? 0.65 : 1,
                      boxShadow: isSelected ? theme.shadow.sm : 'none',
                      transition: `background-color ${theme.animation.duration.normal} ${theme.animation.easing.easeOut}, border-color ${theme.animation.duration.normal} ${theme.animation.easing.easeOut}`,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: '0.75rem',
                      }}
                    >
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.5rem', flex: 1 }}>
                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '0.5rem',
                          }}
                        >
                          <span
                            style={{
                              fontSize: theme.fontSize.bodyLarge,
                              fontWeight: 600,
                              color: 'var(--color-text-primary)',
                            }}
                          >
                            {issue.title}
                          </span>
                          <span
                            style={{
                              fontSize: theme.fontSize.caption,
                              fontWeight: 600,
                              padding: '0.125rem 0.5rem',
                              borderRadius: theme.borderRadius.full,
                              backgroundColor: `var(--color-accent-${statusTone}-bg)`,
                              color: `var(--color-accent-${statusTone})`,
                              letterSpacing: '0.02em',
                              textTransform: 'uppercase',
                            }}
                          >
                            {statusLabel}
                          </span>
                        </div>

                        <div
                          style={{
                            display: 'flex',
                            flexWrap: 'wrap',
                            alignItems: 'center',
                            gap: '0.4rem',
                            fontSize: theme.fontSize.caption,
                            color: 'var(--color-text-tertiary)',
                          }}
                        >
                          {metadata.map((part, index) => (
                            <span key={part}>
                              {part}
                              {index < metadata.length - 1 ? ' ·' : ''}
                            </span>
                          ))}
                        </div>

                        {renderLabelChips(issue.labels, { compact: true })}
                      </div>
                      {isLoading && (
                        <span
                          className="text-xs"
                          style={{ color: 'var(--color-text-secondary)' }}
                        >
                          {t.githubIssue.loading}
                        </span>
                      )}
                    </div>
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
