import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { theme } from '../../common/theme'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useGithubPrSearch } from '../../hooks/useGithubPrSearch'
import { useToast } from '../../common/toast/ToastProvider'
import { MarkdownRenderer } from '../specs/MarkdownRenderer'
import type { GithubPrSelectionResult, GithubPrSummary } from '../../types/githubIssues'
import { TauriCommands } from '../../common/tauriCommands'
import { withOpacity } from '../../common/colorUtils'
import { buildPrPreview, buildPrPrompt, formatPrUpdatedTimestamp } from './githubPrFormatting'
import { logger } from '../../utils/logger'

interface Props {
  selection: GithubPrSelectionResult | null
  onPrLoaded: (selection: GithubPrSelectionResult) => void
  onClearSelection: () => void
  onLoadingChange: (loading: boolean) => void
}

export function GitHubPrPromptSection({
  selection,
  onPrLoaded,
  onClearSelection,
  onLoadingChange,
}: Props) {
  const github = useGithubIntegrationContext()
  const { pushToast } = useToast()
  const isCliInstalled = github.status?.installed ?? !github.isGhMissing
  const isAuthenticated = github.status?.authenticated ?? false
  const hasRepository = github.hasRepository
  const integrationReady = isCliInstalled && isAuthenticated && hasRepository
  const { results, loading, error, query, setQuery, fetchDetails, clearError } =
    useGithubPrSearch({ enabled: integrationReady })
  const [activePr, setActivePr] = useState<number | null>(null)
  const [hoveredPr, setHoveredPr] = useState<number | null>(null)
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
    setHoveredPr(null)
  }, [integrationReady])

  useEffect(() => {
    if (error) {
      pushToast({
        tone: 'error',
        title: 'GitHub PR search failed',
        description: error,
      })
      clearError()
    }
  }, [error, pushToast, clearError])

  const handlePrClick = useCallback(
    async (summary: GithubPrSummary) => {
      onLoadingChange(true)
      setActivePr(summary.number)
      try {
        const details = await fetchDetails(summary.number)
        const prompt = buildPrPrompt(details)
        onPrLoaded({ details, prompt })
      } catch (err) {
        logger.error(`Failed to load GitHub PR details for #${summary.number}`, err)
        pushToast({
          tone: 'error',
          title: 'Failed to load PR details',
          description: err instanceof Error ? err.message : String(err),
        })
      } finally {
        onLoadingChange(false)
        setActivePr(null)
      }
    },
    [fetchDetails, onPrLoaded, onLoadingChange, pushToast]
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
    return buildPrPreview(selection.details)
  }, [selection])

  const selectedSummary = selection
    ? results.find(item => item.number === selection.details.number)
    : undefined
  const selectedPrNumber = selection?.details.number ?? null

  if (selection) {
    const { details } = selection
    const state = (selectedSummary?.state ?? 'open').toLowerCase()
    const statusTone =
      state === 'open'
        ? 'green'
        : state === 'merged'
          ? 'violet'
          : 'red'
    const updatedDisplay = selectedSummary ? formatPrUpdatedTimestamp(selectedSummary) : null
    const commentCount = details.comments.length
    const commentLabel =
      commentCount === 0
        ? 'No comments yet'
        : `${commentCount} comment${commentCount === 1 ? '' : 's'}`
    const metaParts = [`#${details.number}`, commentLabel]
    if (updatedDisplay) {
      metaParts.unshift(`Updated ${updatedDisplay}`)
    }

    const statusLabel = state.charAt(0).toUpperCase() + state.slice(1)

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
                {statusLabel}
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

            <div
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-secondary)',
                backgroundColor: 'var(--color-bg-primary)',
                border: '1px solid var(--color-border-subtle)',
                borderRadius: theme.borderRadius.md,
                padding: '0.375rem 0.625rem',
                width: 'fit-content',
              }}
            >
              <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
              </svg>
              <span style={{ fontFamily: 'monospace', fontSize: theme.fontSize.caption }}>{details.headRefName}</span>
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
              View on GitHub
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
          placeholder="Search GitHub pull requests"
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
          Search by title to import the latest GitHub PR context.
        </p>
        <input
          type="search"
          value={query}
          onChange={event => setQuery(event.target.value)}
          placeholder="Search GitHub pull requests"
          aria-label="Search GitHub pull requests"
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
            Loading pull requests…
          </div>
        ) : results.length === 0 ? (
          <div
            className="flex flex-col items-center justify-center gap-2 py-10 text-sm text-center"
            style={{ color: 'var(--color-text-secondary)' }}
          >
            <span role="img" aria-hidden="true">🔍</span>
            <span>No pull requests found for this project.</span>
            <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
              Adjust your search or ensure pull requests exist on GitHub.
            </span>
          </div>
        ) : (
          <ul className="p-2 space-y-2">
            {results.map(pr => {
              const isLoading = activePr === pr.number
              const isHovered = hoveredPr === pr.number
              const isSelected = selectedPrNumber === pr.number
              const state = pr.state.toLowerCase()
              const statusTone =
                state === 'open'
                  ? 'green'
                  : state === 'merged'
                    ? 'violet'
                    : 'red'
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
                `Updated ${formatPrUpdatedTimestamp(pr)}`,
                `#${pr.number}`,
              ]

              if (pr.author) {
                metadata.push(`opened by ${pr.author}`)
              }

              const statusLabel = state.charAt(0).toUpperCase() + state.slice(1)

              return (
                <li key={pr.number}>
                  <button
                    type="button"
                    onClick={() => { void handlePrClick(pr) }}
                    onMouseEnter={() => setHoveredPr(pr.number)}
                    onMouseLeave={() => setHoveredPr(current => (current === pr.number ? null : current))}
                    disabled={isLoading}
                    aria-label={`Use GitHub pull request ${pr.number}: ${pr.title}`}
                    data-testid={`github-pr-result-${pr.number}`}
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
                            {pr.title}
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

                        {renderLabelChips(pr.labels, { compact: true })}
                      </div>
                      {isLoading && (
                        <span
                          className="text-xs"
                          style={{ color: 'var(--color-text-secondary)' }}
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
