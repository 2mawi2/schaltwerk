import { useState, useCallback } from 'react'
import { VscClose, VscSearch } from 'react-icons/vsc'
import { useGitlabIntegrationContext } from '../../contexts/GitlabIntegrationContext'
import { useGitlabMrSearch } from '../../hooks/useGitlabMrSearch'
import { GitlabMrDetail } from '../gitlab/GitlabMrDetail'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import type { GitlabMrDetails, GitlabMrSummary } from '../../types/gitlabTypes'

export function GitlabMrsTab() {
  const { t } = useTranslation()
  const { sources } = useGitlabIntegrationContext()
  const search = useGitlabMrSearch({ sources })
  const [selectedMr, setSelectedMr] = useState<{ iid: number; sourceProject: string; sourceHostname?: string } | null>(null)
  const [details, setDetails] = useState<GitlabMrDetails | null>(null)
  const [loadingDetails, setLoadingDetails] = useState(false)

  const handleSelect = useCallback(async (mr: GitlabMrSummary) => {
    const matchingSource = sources.find(s => s.label === mr.sourceLabel)
    if (!matchingSource) {
      logger.warn('[GitlabMrsTab] No matching source found for label:', mr.sourceLabel)
      return
    }

    setSelectedMr({ iid: mr.iid, sourceProject: matchingSource.projectPath, sourceHostname: matchingSource.hostname })
    setLoadingDetails(true)

    try {
      const d = await search.fetchDetails(mr.iid, matchingSource.projectPath, matchingSource.hostname, matchingSource.label)
      setDetails(d)
    } catch (err) {
      logger.error('[GitlabMrsTab] Failed to fetch MR details', err)
    } finally {
      setLoadingDetails(false)
    }
  }, [sources, search])

  const handleBack = useCallback(() => {
    setSelectedMr(null)
    setDetails(null)
  }, [])

  if (selectedMr && loadingDetails) {
    return (
      <div className="h-full flex items-center justify-center">
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.gitlabMrTab.loading}
        </span>
      </div>
    )
  }

  if (selectedMr && details) {
    return (
      <GitlabMrDetail
        details={details}
        onBack={handleBack}
        onRefreshPipeline={search.fetchPipeline}
        sourceProject={selectedMr.sourceProject}
        sourceHostname={selectedMr.sourceHostname}
      />
    )
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
          placeholder={t.gitlabMrTab.searchPlaceholder}
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
              {t.gitlabMrTab.loading}
            </span>
          </div>
        ) : search.results.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-1">
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
              {t.gitlabMrTab.noMrsFound}
            </span>
            <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)', opacity: 0.7 }}>
              {t.gitlabMrTab.adjustSearch}
            </span>
          </div>
        ) : (
          search.results.map((mr) => (
            <MrRow key={`${mr.sourceLabel}-${mr.iid}`} mr={mr} onSelect={handleSelect} />
          ))
        )}
      </div>
    </div>
  )
}

function MrStateBadgeInline({ state }: { state: string }) {
  const { t } = useTranslation()

  let label: string
  let color: string

  switch (state) {
    case 'merged':
      label = t.gitlabMrTab.merged
      color = 'var(--color-accent-violet)'
      break
    case 'closed':
      label = t.gitlabMrTab.closed
      color = 'var(--color-accent-red)'
      break
    default:
      label = t.gitlabMrTab.opened
      color = 'var(--color-accent-green)'
      break
  }

  return (
    <span style={{ fontSize: theme.fontSize.caption, fontWeight: 600, color }}>
      {label}
    </span>
  )
}

function MrRow({ mr, onSelect }: { mr: GitlabMrSummary; onSelect: (mr: GitlabMrSummary) => Promise<void> }) {
  const { t } = useTranslation()

  return (
    <button
      type="button"
      className="w-full text-left px-3 py-2 flex flex-col gap-1"
      style={{
        borderBottom: '1px solid var(--color-border-default)',
        backgroundColor: 'transparent',
        cursor: 'pointer',
      }}
      onClick={() => { void onSelect(mr) }}
      onMouseEnter={(e) => { e.currentTarget.style.backgroundColor = 'var(--color-bg-hover)' }}
      onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = 'transparent' }}
    >
      <div className="flex items-center gap-2">
        <MrStateBadgeInline state={mr.state} />
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          !{mr.iid}
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
          {mr.sourceLabel}
        </span>
        <span className="flex-1" />
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          {t.gitlabMrTab.updated.replace('{time}', formatRelativeDate(mr.updatedAt))}
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
        {mr.title}
      </div>
      <div className="flex items-center gap-1.5">
        <span
          style={{
            fontSize: theme.fontSize.caption,
            fontFamily: theme.fontFamily.mono,
            color: 'var(--color-text-muted)',
          }}
        >
          {mr.sourceBranch}
        </span>
        <span style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-muted)' }}>
          &rarr;
        </span>
        <span
          style={{
            fontSize: theme.fontSize.caption,
            fontFamily: theme.fontFamily.mono,
            color: 'var(--color-text-muted)',
          }}
        >
          {mr.targetBranch}
        </span>
      </div>
    </button>
  )
}
