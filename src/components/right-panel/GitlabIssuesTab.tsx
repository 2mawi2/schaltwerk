import { useState, useCallback } from 'react'
import { VscClose, VscSearch } from 'react-icons/vsc'
import { useGitlabIntegrationContext } from '../../contexts/GitlabIntegrationContext'
import { useGitlabIssueSearch } from '../../hooks/useGitlabIssueSearch'
import { GitlabIssueDetail } from '../gitlab/GitlabIssueDetail'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import type { GitlabIssueDetails, GitlabIssueSummary } from '../../types/gitlabTypes'

export function GitlabIssuesTab() {
  const { t } = useTranslation()
  const { sources } = useGitlabIntegrationContext()
  const search = useGitlabIssueSearch({ sources })
  const [selectedIssue, setSelectedIssue] = useState<{ iid: number; sourceProject: string; sourceHostname?: string } | null>(null)
  const [details, setDetails] = useState<GitlabIssueDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const handleSelect = useCallback(async (issue: GitlabIssueSummary) => {
    const matchingSource = sources.find(s => s.label === issue.sourceLabel)
    if (!matchingSource) {
      logger.warn('[GitlabIssuesTab] No matching source found for label:', issue.sourceLabel)
      return
    }

    setSelectedIssue({ iid: issue.iid, sourceProject: matchingSource.projectPath, sourceHostname: matchingSource.hostname })
    setLoadingDetails(true)

    try {
      const d = await search.fetchDetails(issue.iid, matchingSource.projectPath, matchingSource.hostname, matchingSource.label)
      setDetails(d)
    } catch (err) {
      logger.error('[GitlabIssuesTab] Failed to fetch issue details', err)
    } finally {
      setLoadingDetails(false)
    }
  }, [sources, search])

  const handleBack = useCallback(() => {
    setSelectedIssue(null)
    setDetails(null)
  }, [])

  if (selectedIssue && loadingDetails) {
    return (
      <div className="h-full flex items-center justify-center">
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.gitlabIssueTab.loading}
        </span>
      </div>
    )
  }

  if (selectedIssue && details) {
    return <GitlabIssueDetail details={details} onBack={handleBack} />
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      <div
        className="flex items-center gap-2 px-3 py-2 flex-shrink-0"
        style={{ borderBottom: '1px solid var(--color-border-default)' }}
      >
        <VscSearch className="w-3.5 h-3.5 flex-shrink-0" style={{ color: 'var(--color-text-muted)' }} />
        <input
          type="text"
          value={search.query}
          onChange={(e) => search.setQuery(e.target.value)}
          placeholder={t.gitlabIssueTab.searchPlaceholder}
          className="flex-1 bg-transparent border-none outline-none"
          style={{
            fontSize: theme.fontSize.body,
            color: 'var(--color-text-primary)',
            fontFamily: theme.fontFamily.sans,
          }}
        />
        {search.query && (
          <button
            type="button"
            onClick={() => search.setQuery('')}
            style={{ color: 'var(--color-text-muted)' }}
          >
            <VscClose className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {search.error && (
        <div
          className="flex items-center justify-between px-3 py-1.5 flex-shrink-0"
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-accent-red)',
            backgroundColor: 'var(--color-accent-red-bg)',
          }}
        >
          <span className="truncate">{search.error}</span>
          <button
            type="button"
            onClick={search.clearError}
            style={{ color: 'var(--color-accent-red)', flexShrink: 0 }}
          >
            <VscClose className="w-3 h-3" />
          </button>
        </div>
      )}

      <div className="flex-1 overflow-y-auto">
        {search.loading && search.results.length === 0 ? (
          <div className="flex items-center justify-center py-8">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.gitlabIssueTab.loading}
            </span>
          </div>
        ) : search.results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-1">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.gitlabIssueTab.noIssuesFound}
            </span>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', opacity: 0.7 }}>
              {t.gitlabIssueTab.adjustSearch}
            </span>
          </div>
        ) : (
          search.results.map((issue) => (
            <IssueRow key={`${issue.sourceLabel}-${issue.iid}`} issue={issue} onSelect={handleSelect} />
          ))
        )}
      </div>
    </div>
  )
}

function IssueRow({ issue, onSelect }: { issue: GitlabIssueSummary; onSelect: (issue: GitlabIssueSummary) => Promise<void> }) {
  const { t } = useTranslation()
  const isOpen = issue.state === 'opened'

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-2 flex flex-col gap-1"
      style={{
        borderBottom: '1px solid var(--color-border-default)',
        backgroundColor: 'transparent',
        cursor: 'pointer',
      }}
      onClick={() => { void onSelect(issue) }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        <span
          style={{
            fontSize: theme.fontSize.caption,
            fontWeight: 600,
            color: isOpen ? 'var(--color-accent-green)' : 'var(--color-accent-red)',
          }}
        >
          {isOpen ? t.gitlabIssueTab.opened : t.gitlabIssueTab.closed}
        </span>
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          #{issue.iid}
        </span>
        <span
          style={{
            fontSize: theme.fontSize.caption,
            color: 'var(--color-text-muted)',
            backgroundColor: 'var(--color-bg-elevated)',
            borderRadius: 9999,
            padding: '0 6px',
            lineHeight: theme.lineHeight.badge,
          }}
        >
          {issue.sourceLabel}
        </span>
        <span className="flex-1" />
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.gitlabIssueTab.updated.replace('{time}', formatRelativeDate(issue.updatedAt))}
        </span>
      </div>
      <div
        className="truncate"
        style={{
          fontSize: theme.fontSize.body,
          color: 'var(--color-text-primary)',
          fontFamily: theme.fontFamily.sans,
          lineHeight: theme.lineHeight.body,
        }}
      >
        {issue.title}
      </div>
    </button>
  )
}
