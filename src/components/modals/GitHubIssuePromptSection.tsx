import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useGithubIssueSearch } from '../../hooks/useGithubIssueSearch'
import { useToast } from '../../common/toast/ToastProvider'
import { MarkdownRenderer } from '../plans/MarkdownRenderer'
import type { GithubIssueSelectionResult, GithubIssueSummary } from '../../types/githubIssues'
import { TauriCommands } from '../../common/tauriCommands'
import { withOpacity } from '../../common/colorUtils'
import { buildIssuePreview, buildIssuePrompt, formatIssueUpdatedTimestamp } from './githubIssueFormatting'

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
  const github = useGithubIntegrationContext()
  const { pushToast } = useToast()
  const isCliInstalled = github.status?.installed ?? !github.isGhMissing
  const isAuthenticated = github.status?.authenticated ?? false
  const hasRepository = github.hasRepository
  const integrationReady = isCliInstalled && isAuthenticated && hasRepository
  const missingInstall = !isCliInstalled
  const missingAuth = !isAuthenticated
  const missingRepository = !hasRepository

  const { results, loading, error, query, setQuery, refresh, fetchDetails, clearError } =
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
          const baseHex = label.color ? `#${label.color}` : theme.colors.accent.blue.DEFAULT
          return (
            <span
              key={label.name}
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.25rem',
                padding: '0.25rem 0.5rem',
                borderRadius: theme.borderRadius.full,
                border: `1px solid ${withOpacity(baseHex, 0.4)}`,
                backgroundColor: withOpacity(baseHex, 0.16),
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
        title: 'GitHub issue search failed',
        description: error,
      })
      clearError()
    }
  }, [error, pushToast, clearError])

  const handleInstallClick = useCallback(() => {
    if (typeof window !== 'undefined' && typeof window.open === 'function') {
      window.open('https://cli.github.com/manual/installation', '_blank', 'noopener,noreferrer')
    }
  }, [])

  const handleAuthenticateClick = useCallback(async () => {
    try {
      await github.authenticate()
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'GitHub authentication failed',
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [github, pushToast])

  const handleConnectClick = useCallback(async () => {
    try {
      await github.connectProject()
      await github.refreshStatus()
      refresh()
    } catch (err) {
      pushToast({
        tone: 'error',
        title: 'Failed to connect repository',
        description: err instanceof Error ? err.message : String(err),
      })
    }
  }, [github, pushToast, refresh])

  const handleIssueClick = useCallback(
    async (summary: GithubIssueSummary) => {
      onLoadingChange(true)
      setActiveIssue(summary.number)
      try {
        const details = await fetchDetails(summary.number)
        const prompt = buildIssuePrompt(details)
        onIssueLoaded({ details, prompt })
      } catch (err) {
        pushToast({
          tone: 'error',
          title: 'Failed to load issue details',
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
          title: 'Failed to open link',
          description: error instanceof Error ? error.message : String(error),
        })
      }
    },
    [pushToast]
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
    const statusTheme =
      state === 'open'
        ? theme.colors.accent.green
        : theme.colors.accent.red
    const updatedDisplay = selectedSummary ? formatIssueUpdatedTimestamp(selectedSummary) : null
    const commentCount = details.comments.length
    const commentLabel =
      commentCount === 0
        ? 'No comments yet'
        : `${commentCount} comment${commentCount === 1 ? '' : 's'}`
    const metaParts = [`#${details.number}`, commentLabel]
    if (updatedDisplay) {
      metaParts.unshift(`Updated ${updatedDisplay}`)
    }

    return (
      <div
        className="flex flex-col h-full border rounded"
        style={{ borderColor: theme.colors.border.subtle, backgroundColor: theme.colors.background.elevated }}
      >
        <div
          className="flex items-start justify-between gap-4 border-b"
          style={{
            borderColor: theme.colors.border.subtle,
            padding: '16px 18px',
          }}
        >
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
            <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: '0.75rem' }}>
              <span
                style={{
                  fontSize: theme.fontSize.headingLarge,
                  fontWeight: 600,
                  color: theme.colors.text.primary,
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
                  backgroundColor: statusTheme.bg,
                  color: statusTheme.DEFAULT,
                  letterSpacing: '0.04em',
                  textTransform: 'uppercase',
                }}
              >
                {state === 'open' ? 'Open' : 'Closed'}
              </span>
            </div>

            <div
              style={{
                display: 'flex',
                flexWrap: 'wrap',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: theme.fontSize.caption,
                color: theme.colors.text.tertiary,
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
              onClick={() => handleOpenLink(details.url)}
              className="px-2 py-1 text-xs rounded border transition-colors"
              style={{
                backgroundColor: theme.colors.accent.blue.bg,
                border: `1px solid ${theme.colors.accent.blue.border}`,
                color: theme.colors.accent.blue.DEFAULT,
                padding: '0.5rem 0.75rem',
                fontSize: theme.fontSize.button,
              }}
            >
              View on GitHub
            </button>
            <button
              type="button"
              onClick={onClearSelection}
              className="px-2 py-1 text-xs rounded border transition-colors"
              style={{
                backgroundColor: theme.colors.background.primary,
                border: `1px solid ${theme.colors.border.subtle}`,
                color: theme.colors.text.secondary,
              }}
            >
              Clear selection
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
              border: `1px solid ${theme.colors.border.subtle}`,
              backgroundColor: theme.colors.background.primary,
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
        style={{ borderColor: theme.colors.border.subtle, backgroundColor: theme.colors.background.elevated }}
      >
        <p className="text-sm" style={{ color: theme.colors.text.primary }}>
          Connect GitHub to import issue descriptions as prompts.
        </p>
        <div className="flex flex-wrap gap-2">
          {missingInstall && (
            <button
              type="button"
              onClick={handleInstallClick}
              className="px-3 py-1.5 text-xs rounded"
              style={{
                backgroundColor: theme.colors.background.primary,
                border: `1px solid ${theme.colors.border.subtle}`,
                color: theme.colors.text.primary,
              }}
            >
              Install GitHub CLI
            </button>
          )}
          {missingAuth && (
            <button
              type="button"
              onClick={handleAuthenticateClick}
              className="px-3 py-1.5 text-xs rounded"
              style={{
                backgroundColor: theme.colors.background.primary,
                border: `1px solid ${theme.colors.border.subtle}`,
                color: theme.colors.text.primary,
              }}
            >
              Authenticate GitHub
            </button>
          )}
          {missingRepository && (
            <button
              type="button"
              onClick={handleConnectClick}
              className="px-3 py-1.5 text-xs rounded"
              style={{
                backgroundColor: theme.colors.background.primary,
                border: `1px solid ${theme.colors.border.subtle}`,
                color: theme.colors.text.primary,
              }}
            >
              Connect repository
            </button>
          )}
        </div>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search GitHub issues"
          disabled
          className="px-3 py-2 rounded text-sm"
          style={{
            backgroundColor: theme.colors.background.primary,
            color: theme.colors.text.secondary,
            border: `1px solid ${theme.colors.border.subtle}`,
            opacity: 0.6,
          }}
        />
      </div>
    )
  }

  return (
    <div
      className="flex flex-col h-full border rounded"
      style={{ borderColor: theme.colors.border.subtle, backgroundColor: theme.colors.background.elevated }}
    >
      <div className="p-3 border-b space-y-2" style={{ borderColor: theme.colors.border.subtle }}>
        <p className="text-xs" style={{ color: theme.colors.text.secondary }}>
          Search by title or label to import the latest GitHub issue context.
        </p>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search GitHub issues"
          aria-label="Search GitHub issues"
          className="w-full px-3 py-2 text-sm rounded"
          style={{
            backgroundColor: theme.colors.background.primary,
            color: theme.colors.text.primary,
            border: `1px solid ${theme.colors.border.default}`,
            boxShadow: '0 0 0 1px transparent',
          }}
          onFocus={event => {
            event.currentTarget.style.boxShadow = `0 0 0 1px ${theme.colors.accent.blue.DEFAULT}`;
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
            style={{ color: theme.colors.text.secondary }}
          >
            <span
              className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
              style={{ borderColor: theme.colors.accent.blue.DEFAULT }}
            />
            Loading issues…
          </div>
        ) : results.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-center"
            style={{ color: theme.colors.text.secondary }}
          >
            <span role="img" aria-hidden="true">🔍</span>
            <span>No issues found for this project.</span>
            <span className="text-xs" style={{ color: theme.colors.text.secondary }}>
              Adjust your search or ensure issues exist on GitHub.
            </span>
          </div>
        ) : (
          <ul className="p-2 space-y-2">
            {results.map(issue => {
              const isLoading = activeIssue === issue.number
              const isHovered = hoveredIssue === issue.number
              const isSelected = selectedIssueNumber === issue.number
              const state = issue.state.toLowerCase()
              const statusTheme =
                state === 'open'
                  ? theme.colors.accent.green
                  : theme.colors.accent.red
              const baseBackground = theme.colors.background.primary
              const backgroundColor = isSelected
                ? theme.colors.accent.blue.bg
                : isHovered
                  ? theme.colors.background.hover
                  : baseBackground
              const borderColor = isSelected
                ? theme.colors.accent.blue.DEFAULT
                : isHovered
                  ? theme.colors.border.strong
                  : theme.colors.border.subtle

              const metadata: string[] = [
                `Updated ${formatIssueUpdatedTimestamp(issue)}`,
                `#${issue.number}`,
              ]

              if (issue.author) {
                metadata.push(`opened by ${issue.author}`)
              }

              const statusLabel = state.charAt(0).toUpperCase() + state.slice(1)

              return (
                <li key={issue.number}>
                  <button
                    type="button"
                    onClick={() => handleIssueClick(issue)}
                    onMouseEnter={() => setHoveredIssue(issue.number)}
                    onMouseLeave={() => setHoveredIssue(current => (current === issue.number ? null : current))}
                    disabled={isLoading}
                    aria-label={`Use GitHub issue ${issue.number}: ${issue.title}`}
                    data-testid={`github-issue-result-${issue.number}`}
                    className="w-full text-left"
                    style={{
                      backgroundColor,
                      color: theme.colors.text.primary,
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
                              color: theme.colors.text.primary,
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
                              backgroundColor: statusTheme.bg,
                              color: statusTheme.DEFAULT,
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
                            color: theme.colors.text.tertiary,
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
                          style={{ color: theme.colors.text.secondary }}
                        >
                          Loading…
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
