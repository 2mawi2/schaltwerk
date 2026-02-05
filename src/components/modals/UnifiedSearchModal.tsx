import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { theme } from '../../common/theme'
import { useTranslation } from '../../common/i18n'
import { useModal } from '../../contexts/ModalContext'
import { useBranchSearch } from '../../hooks/useBranchSearch'
import { useGithubIssueSearch } from '../../hooks/useGithubIssueSearch'
import { useGithubPrSearch } from '../../hooks/useGithubPrSearch'
import { buildIssuePrompt } from './githubIssueFormatting'
import { buildPrPrompt } from './githubPrFormatting'
import { formatIssueUpdatedTimestamp } from './githubIssueFormatting'
import { formatPrUpdatedTimestamp } from './githubPrFormatting'
import { withOpacity } from '../../common/colorUtils'
import { logger } from '../../utils/logger'
import type { GithubIssueSelectionResult, GithubPrSelectionResult } from '../../types/githubIssues'

type TabId = 'branches' | 'prs' | 'issues'

interface Props {
  open: boolean
  onClose: () => void
  onSelectBranch: (branch: string) => void
  onSelectIssue: (selection: GithubIssueSelectionResult) => void
  onSelectPr: (selection: GithubPrSelectionResult) => void
  githubReady: boolean
}

export function UnifiedSearchModal({
  open,
  onClose,
  onSelectBranch,
  onSelectIssue,
  onSelectPr,
  githubReady,
}: Props) {
  const { t } = useTranslation()
  const { registerModal, unregisterModal } = useModal()
  const [activeTab, setActiveTab] = useState<TabId>('branches')
  const [searchQuery, setSearchQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(-1)
  const [loadingItem, setLoadingItem] = useState<number | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const branchSearch = useBranchSearch({ enabled: open })
  const issueSearch = useGithubIssueSearch({ enabled: open && githubReady })
  const prSearch = useGithubPrSearch({ enabled: open && githubReady })

  useLayoutEffect(() => {
    if (open) {
      registerModal('UnifiedSearchModal')
    } else {
      unregisterModal('UnifiedSearchModal')
    }
  }, [open, registerModal, unregisterModal])

  useEffect(() => {
    if (!open) return
    const handleEscapeCapture = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('keydown', handleEscapeCapture, true)
    return () => {
      window.removeEventListener('keydown', handleEscapeCapture, true)
    }
  }, [open, onClose])

  useEffect(() => {
    if (open) {
      setSearchQuery('')
      setHighlightedIndex(-1)
      setActiveTab(githubReady ? 'prs' : 'branches')
      setLoadingItem(null)
      branchSearch.setQuery('')
      issueSearch.setQuery('')
      prSearch.setQuery('')
      requestAnimationFrame(() => {
        inputRef.current?.focus()
      })
    }
  }, [open])

  const handleSearchChange = useCallback((value: string) => {
    setSearchQuery(value)
    setHighlightedIndex(-1)
    branchSearch.setQuery(value)
    issueSearch.setQuery(value)
    prSearch.setQuery(value)
  }, [branchSearch, issueSearch, prSearch])

  const handleTabChange = useCallback((tab: TabId) => {
    if ((tab === 'prs' || tab === 'issues') && !githubReady) {
      return
    }
    setActiveTab(tab)
    setHighlightedIndex(-1)
    inputRef.current?.focus()
  }, [githubReady])

  const currentListLength = activeTab === 'branches'
    ? branchSearch.filteredBranches.length
    : activeTab === 'prs'
      ? prSearch.results.length
      : issueSearch.results.length

  const handleSelectHighlighted = useCallback(async () => {
    if (highlightedIndex < 0) return

    if (activeTab === 'branches') {
      const branch = branchSearch.filteredBranches[highlightedIndex]
      if (branch) {
        onSelectBranch(branch)
        onClose()
      }
    } else if (activeTab === 'issues') {
      const issue = issueSearch.results[highlightedIndex]
      if (issue) {
        setLoadingItem(issue.number)
        try {
          const details = await issueSearch.fetchDetails(issue.number)
          const prompt = buildIssuePrompt(details)
          onSelectIssue({ details, prompt })
          onClose()
        } catch (err) {
          logger.error(`Failed to load issue #${issue.number}`, err)
        } finally {
          setLoadingItem(null)
        }
      }
    } else {
      const pr = prSearch.results[highlightedIndex]
      if (pr) {
        setLoadingItem(pr.number)
        try {
          const details = await prSearch.fetchDetails(pr.number)
          const prompt = buildPrPrompt(details)
          onSelectPr({ details, prompt })
          onClose()
        } catch (err) {
          logger.error(`Failed to load PR #${pr.number}`, err)
        } finally {
          setLoadingItem(null)
        }
      }
    }
  }, [highlightedIndex, activeTab, branchSearch.filteredBranches, issueSearch, prSearch, onSelectBranch, onSelectIssue, onSelectPr, onClose])

  const enabledTabs = useCallback((): TabId[] => {
    const all: TabId[] = ['prs', 'issues', 'branches']
    return all.filter(id => id === 'branches' || githubReady)
  }, [githubReady])

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      onClose()
      return
    }

    if (e.key === 'Tab') {
      e.preventDefault()
      const enabled = enabledTabs()
      const currentIdx = enabled.indexOf(activeTab)
      const next = e.shiftKey
        ? (currentIdx - 1 + enabled.length) % enabled.length
        : (currentIdx + 1) % enabled.length
      handleTabChange(enabled[next])
      return
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setHighlightedIndex(prev => {
        const next = prev + 1
        return next >= currentListLength ? prev : next
      })
      return
    }

    if (e.key === 'ArrowUp') {
      e.preventDefault()
      setHighlightedIndex(prev => (prev <= 0 ? 0 : prev - 1))
      return
    }

    if (e.key === 'Enter' && highlightedIndex >= 0) {
      e.preventDefault()
      void handleSelectHighlighted()
      return
    }

  }, [onClose, currentListLength, highlightedIndex, handleSelectHighlighted, handleTabChange, activeTab, enabledTabs])

  useEffect(() => {
    if (highlightedIndex >= 0 && listRef.current) {
      const item = listRef.current.querySelector(`[data-index="${highlightedIndex}"]`)
      item?.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  if (!open) return null

  const tabs: Array<{ id: TabId; label: string; testId: string; disabled: boolean }> = [
    { id: 'prs', label: t.newSessionModal.unifiedSearch.pullRequestsTab, testId: 'tab-prs', disabled: !githubReady },
    { id: 'issues', label: t.newSessionModal.unifiedSearch.issuesTab, testId: 'tab-issues', disabled: !githubReady },
    { id: 'branches', label: t.newSessionModal.unifiedSearch.branchesTab, testId: 'tab-branches', disabled: false },
  ]

  const renderBranchList = () => {
    if (branchSearch.loading) {
      return (
        <div data-testid="unified-search-loading" className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent-blue)' }} />
          {t.newSessionModal.unifiedSearch.loading}
        </div>
      )
    }

    if (branchSearch.filteredBranches.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t.newSessionModal.unifiedSearch.noBranchesFound}
        </div>
      )
    }

    return (
      <ul className="p-2 space-y-1">
        {branchSearch.filteredBranches.map((branch, index) => {
          const isHighlighted = highlightedIndex === index
          return (
            <li key={branch}>
              <button
                type="button"
                data-testid={`branch-item-${index}`}
                data-index={index}
                data-highlighted={isHighlighted}
                onClick={() => {
                  onSelectBranch(branch)
                  onClose()
                }}
                className="w-full text-left px-3 py-2 rounded text-sm"
                style={{
                  backgroundColor: isHighlighted ? 'var(--color-bg-hover)' : 'transparent',
                  color: 'var(--color-text-primary)',
                  fontFamily: theme.fontFamily.mono,
                  fontSize: theme.fontSize.body,
                }}
              >
                {branch}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const renderIssueList = () => {
    if (!githubReady) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t.newSessionModal.unifiedSearch.githubNotConnected}
        </div>
      )
    }

    if (issueSearch.loading) {
      return (
        <div data-testid="unified-search-loading" className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent-blue)' }} />
          {t.newSessionModal.unifiedSearch.loading}
        </div>
      )
    }

    if (issueSearch.results.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t.newSessionModal.unifiedSearch.noIssuesFound}
        </div>
      )
    }

    return (
      <ul className="p-2 space-y-2">
        {issueSearch.results.map((issue, index) => {
          const isHighlighted = highlightedIndex === index
          const isItemLoading = loadingItem === issue.number
          const state = issue.state.toLowerCase()
          const statusTone = state === 'open' ? 'green' : 'red'
          const statusLabel = state.charAt(0).toUpperCase() + state.slice(1)

          return (
            <li key={issue.number}>
              <button
                type="button"
                data-testid={`issue-item-${index}`}
                data-index={index}
                data-highlighted={isHighlighted}
                disabled={isItemLoading}
                onClick={() => {
                  setLoadingItem(issue.number)
                  issueSearch.fetchDetails(issue.number)
                    .then(details => {
                      const prompt = buildIssuePrompt(details)
                      onSelectIssue({ details, prompt })
                      onClose()
                    })
                    .catch(err => {
                      logger.error(`Failed to load issue #${issue.number}`, err)
                    })
                    .finally(() => {
                      setLoadingItem(null)
                    })
                }}
                className="w-full text-left rounded"
                style={{
                  backgroundColor: isHighlighted ? 'var(--color-bg-hover)' : 'var(--color-bg-primary)',
                  border: `1px solid ${isHighlighted ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
                  borderRadius: theme.borderRadius.lg,
                  padding: '12px 14px',
                  cursor: isItemLoading ? 'wait' : 'pointer',
                  opacity: isItemLoading ? 0.65 : 1,
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ fontSize: theme.fontSize.body, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {issue.title}
                    </span>
                    <span style={{
                      fontSize: theme.fontSize.caption,
                      fontWeight: 600,
                      padding: '0.125rem 0.5rem',
                      borderRadius: theme.borderRadius.full,
                      backgroundColor: `var(--color-accent-${statusTone}-bg)`,
                      color: `var(--color-accent-${statusTone})`,
                      textTransform: 'uppercase',
                      letterSpacing: '0.02em',
                    }}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5" style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-tertiary)' }}>
                    <span>#{issue.number}</span>
                    <span>·</span>
                    <span>{t.githubIssue.updated.replace('{time}', formatIssueUpdatedTimestamp(issue))}</span>
                    {issue.author && (
                      <>
                        <span>·</span>
                        <span>{t.githubIssue.openedBy.replace('{author}', issue.author)}</span>
                      </>
                    )}
                  </div>
                  {issue.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" style={{ marginTop: '2px' }}>
                      {issue.labels.map(label => {
                        const isFallback = !label.color
                        const baseHex = label.color ? `#${label.color}` : 'var(--color-accent-blue)'
                        return (
                          <span
                            key={label.name}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '0.125rem 0.375rem',
                              borderRadius: theme.borderRadius.full,
                              border: `1px solid ${isFallback ? 'var(--color-accent-blue-border)' : withOpacity(baseHex, 0.4)}`,
                              backgroundColor: isFallback ? 'var(--color-accent-blue-bg)' : withOpacity(baseHex, 0.16),
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
                  )}
                </div>
                {isItemLoading && (
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {t.githubIssue.loading}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  const renderPrList = () => {
    if (!githubReady) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t.newSessionModal.unifiedSearch.githubNotConnected}
        </div>
      )
    }

    if (prSearch.loading) {
      return (
        <div data-testid="unified-search-loading" className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          <span className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin" style={{ borderColor: 'var(--color-accent-blue)' }} />
          {t.newSessionModal.unifiedSearch.loading}
        </div>
      )
    }

    if (prSearch.results.length === 0) {
      return (
        <div className="flex flex-col items-center justify-center gap-2 py-10 text-sm" style={{ color: 'var(--color-text-secondary)' }}>
          {t.newSessionModal.unifiedSearch.noPrsFound}
        </div>
      )
    }

    return (
      <ul className="p-2 space-y-2">
        {prSearch.results.map((pr, index) => {
          const isHighlighted = highlightedIndex === index
          const isItemLoading = loadingItem === pr.number
          const state = pr.state.toLowerCase()
          const statusTone = state === 'open' ? 'green' : state === 'merged' ? 'violet' : 'red'
          const statusLabel = state.charAt(0).toUpperCase() + state.slice(1)

          return (
            <li key={pr.number}>
              <button
                type="button"
                data-testid={`pr-item-${index}`}
                data-index={index}
                data-highlighted={isHighlighted}
                disabled={isItemLoading}
                onClick={() => {
                  setLoadingItem(pr.number)
                  prSearch.fetchDetails(pr.number)
                    .then(details => {
                      const prompt = buildPrPrompt(details)
                      onSelectPr({ details, prompt })
                      onClose()
                    })
                    .catch(err => {
                      logger.error(`Failed to load PR #${pr.number}`, err)
                    })
                    .finally(() => {
                      setLoadingItem(null)
                    })
                }}
                className="w-full text-left rounded"
                style={{
                  backgroundColor: isHighlighted ? 'var(--color-bg-hover)' : 'var(--color-bg-primary)',
                  border: `1px solid ${isHighlighted ? 'var(--color-border-strong)' : 'var(--color-border-subtle)'}`,
                  borderRadius: theme.borderRadius.lg,
                  padding: '12px 14px',
                  cursor: isItemLoading ? 'wait' : 'pointer',
                  opacity: isItemLoading ? 0.65 : 1,
                }}
              >
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span style={{ fontSize: theme.fontSize.body, fontWeight: 600, color: 'var(--color-text-primary)' }}>
                      {pr.title}
                    </span>
                    <span style={{
                      fontSize: theme.fontSize.caption,
                      fontWeight: 600,
                      padding: '0.125rem 0.5rem',
                      borderRadius: theme.borderRadius.full,
                      backgroundColor: `var(--color-accent-${statusTone}-bg)`,
                      color: `var(--color-accent-${statusTone})`,
                      textTransform: 'uppercase',
                      letterSpacing: '0.02em',
                    }}>
                      {statusLabel}
                    </span>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5" style={{ fontSize: theme.fontSize.caption, color: 'var(--color-text-tertiary)' }}>
                    <span>#{pr.number}</span>
                    <span>·</span>
                    <span>{t.githubPr.updated.replace('{time}', formatPrUpdatedTimestamp(pr))}</span>
                    {pr.author && (
                      <>
                        <span>·</span>
                        <span>{t.githubPr.openedBy.replace('{author}', pr.author)}</span>
                      </>
                    )}
                  </div>
                  <div
                    className="inline-flex items-center gap-1.5"
                    style={{
                      fontSize: theme.fontSize.caption,
                      color: 'var(--color-text-secondary)',
                      backgroundColor: 'var(--color-bg-elevated)',
                      border: '1px solid var(--color-border-subtle)',
                      borderRadius: theme.borderRadius.md,
                      padding: '0.25rem 0.5rem',
                      width: 'fit-content',
                    }}
                  >
                    <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style={{ flexShrink: 0 }}>
                      <path fillRule="evenodd" d="M11.75 2.5a.75.75 0 100 1.5.75.75 0 000-1.5zm-2.25.75a2.25 2.25 0 113 2.122V6A2.5 2.5 0 0110 8.5H6a1 1 0 00-1 1v1.128a2.251 2.251 0 11-1.5 0V5.372a2.25 2.25 0 111.5 0v1.836A2.492 2.492 0 016 7h4a1 1 0 001-1v-.628A2.25 2.25 0 019.5 3.25zM4.25 12a.75.75 0 100 1.5.75.75 0 000-1.5zM3.5 3.25a.75.75 0 111.5 0 .75.75 0 01-1.5 0z" />
                    </svg>
                    <span style={{ fontFamily: theme.fontFamily.mono, fontSize: theme.fontSize.caption }}>{pr.headRefName}</span>
                  </div>
                  {pr.labels.length > 0 && (
                    <div className="flex flex-wrap gap-1.5" style={{ marginTop: '2px' }}>
                      {pr.labels.map(label => {
                        const isFallback = !label.color
                        const baseHex = label.color ? `#${label.color}` : 'var(--color-accent-blue)'
                        return (
                          <span
                            key={label.name}
                            style={{
                              display: 'inline-flex',
                              alignItems: 'center',
                              padding: '0.125rem 0.375rem',
                              borderRadius: theme.borderRadius.full,
                              border: `1px solid ${isFallback ? 'var(--color-accent-blue-border)' : withOpacity(baseHex, 0.4)}`,
                              backgroundColor: isFallback ? 'var(--color-accent-blue-bg)' : withOpacity(baseHex, 0.16),
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
                  )}
                </div>
                {isItemLoading && (
                  <span className="text-xs" style={{ color: 'var(--color-text-secondary)' }}>
                    {t.githubPr.loading}
                  </span>
                )}
              </button>
            </li>
          )
        })}
      </ul>
    )
  }

  return (
    <div
      data-testid="unified-search-modal"
      className="fixed inset-0 flex items-center justify-center"
      style={{ zIndex: 60 }}
      onKeyDown={handleKeyDown}
    >
      <div
        className="fixed inset-0"
        style={{ backgroundColor: 'var(--color-overlay-backdrop)' }}
        onClick={onClose}
      />
      <div
        className="relative flex flex-col rounded-lg shadow-xl overflow-hidden"
        style={{
          backgroundColor: 'var(--color-bg-elevated)',
          border: '1px solid var(--color-border-default)',
          width: '560px',
          maxHeight: '500px',
        }}
      >
        <div className="p-3 border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          <input
            ref={inputRef}
            data-testid="unified-search-input"
            type="search"
            value={searchQuery}
            onChange={e => handleSearchChange(e.target.value)}
            placeholder={t.newSessionModal.unifiedSearch.searchPlaceholder}
            className="w-full px-3 py-2 text-sm rounded"
            style={{
              backgroundColor: 'var(--color-bg-primary)',
              color: 'var(--color-text-primary)',
              border: '1px solid var(--color-border-default)',
            }}
          />
        </div>

        <div className="flex border-b" style={{ borderColor: 'var(--color-border-subtle)' }}>
          {tabs.map(tab => (
            <button
              key={tab.id}
              type="button"
              data-testid={tab.testId}
              aria-selected={activeTab === tab.id}
              aria-disabled={tab.disabled}
              onClick={() => handleTabChange(tab.id)}
              className="flex-1 px-3 py-2 text-sm text-center transition-colors"
              style={{
                color: tab.disabled
                  ? 'var(--color-text-muted)'
                  : activeTab === tab.id
                    ? 'var(--color-text-primary)'
                    : 'var(--color-text-secondary)',
                borderBottom: activeTab === tab.id
                  ? '2px solid var(--color-accent-blue)'
                  : '2px solid transparent',
                cursor: tab.disabled ? 'not-allowed' : 'pointer',
                opacity: tab.disabled ? 0.5 : 1,
                fontWeight: activeTab === tab.id ? 600 : 400,
              }}
              title={tab.disabled ? t.newSessionModal.unifiedSearch.githubNotConnected : undefined}
            >
              {tab.label}
            </button>
          ))}
        </div>

        <div ref={listRef} className="flex-1 overflow-auto" style={{ maxHeight: '380px' }}>
          {activeTab === 'branches' && renderBranchList()}
          {activeTab === 'issues' && renderIssueList()}
          {activeTab === 'prs' && renderPrList()}
        </div>

        <div
          className="flex items-center justify-center gap-4 px-3 py-1.5 border-t"
          style={{
            borderColor: 'var(--color-border-subtle)',
            color: 'var(--color-text-muted)',
            fontSize: theme.fontSize.caption,
          }}
        >
          <span><kbd className="px-1 rounded" style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}>Tab</kbd> switch tab</span>
          <span><kbd className="px-1 rounded" style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}>↑↓</kbd> navigate</span>
          <span><kbd className="px-1 rounded" style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}>↵</kbd> select</span>
          <span><kbd className="px-1 rounded" style={{ border: '1px solid var(--color-border-subtle)', backgroundColor: 'var(--color-bg-primary)' }}>esc</kbd> close</span>
        </div>
      </div>
    </div>
  )
}
