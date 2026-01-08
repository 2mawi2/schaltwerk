import { useEffect, useCallback, useState } from 'react'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { useGithubPrSearch } from '../../hooks/useGithubPrSearch'
import type { GithubPrSummary } from '../../types/githubIssues'
import { formatRelativeDate } from '../../utils/time'
import { buildPrUrl } from '../../utils/githubUrls'
import { useTranslation } from '../../common/i18n'

interface LinkPrModalProps {
  open: boolean
  currentPrUrl?: string
  onConfirm: (prNumber: number, prUrl: string) => void
  onCancel: () => void
}

export function LinkPrModal({
  open,
  onConfirm,
  onCancel,
}: LinkPrModalProps) {
  const { t } = useTranslation()
  const github = useGithubIntegrationContext()
  const isCliInstalled = github.status?.installed ?? !github.isGhMissing
  const isAuthenticated = github.status?.authenticated ?? false
  const hasRepository = github.hasRepository
  const integrationReady = isCliInstalled && isAuthenticated && hasRepository

  const { results, loading, query, setQuery } = useGithubPrSearch({ enabled: open && integrationReady })
  const [hoveredPr, setHoveredPr] = useState<number | null>(null)

  useEffect(() => {
    if (open) {
      setQuery('')
      setHoveredPr(null)
    }
  }, [open, setQuery])

  useEffect(() => {
    if (!open) return

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onCancel()
      }
    }

    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [open, onCancel])

  const handlePrSelect = useCallback((pr: GithubPrSummary) => {
    const repoName = github.status?.repository?.nameWithOwner
    if (!repoName) return
    const prUrl = buildPrUrl(repoName, pr.number)
    onConfirm(pr.number, prUrl)
  }, [onConfirm, github.status?.repository?.nameWithOwner])

  if (!open) return null

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" role="dialog" aria-modal="true">
      <div
        className="bg-slate-900 border border-slate-700 rounded-lg w-full max-w-lg mx-4 flex flex-col"
        style={{ maxHeight: '70vh' }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="p-4 border-b border-slate-700">
          <h2 className="text-lg font-semibold text-slate-100 mb-3">{t.linkPrModal.title}</h2>

          {!integrationReady ? (
            <p className="text-sm text-slate-400">
              {t.linkPrModal.integrationNotAvailable}
            </p>
          ) : (
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t.linkPrModal.searchPlaceholder}
              autoFocus
              className="w-full px-3 py-2 bg-slate-800 border border-slate-700 rounded-md text-slate-100 placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-sm"
            />
          )}
        </div>

        <div className="flex-1 overflow-auto min-h-0">
          {!integrationReady ? (
            <div className="p-4 text-center text-slate-500 text-sm">
              {t.linkPrModal.connectToGithub}
            </div>
          ) : loading ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <span
                className="h-4 w-4 rounded-full border-2 border-t-transparent animate-spin"
                style={{ borderColor: 'var(--color-accent-blue)' }}
              />
              {t.linkPrModal.loadingPrs}
            </div>
          ) : results.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 py-8 text-sm text-slate-400">
              <span>{t.linkPrModal.noPrsFound}</span>
              <span className="text-xs text-slate-500">
                {query ? t.linkPrModal.tryDifferentSearch : t.linkPrModal.noOpenPrs}
              </span>
            </div>
          ) : (
            <ul className="p-2 space-y-1">
              {results.map(pr => {
                const isHovered = hoveredPr === pr.number
                const state = pr.state.toLowerCase()
                const statusTone =
                  state === 'open'
                    ? 'green'
                    : state === 'merged'
                      ? 'violet'
                      : 'red'

                return (
                  <li key={pr.number}>
                    <button
                      type="button"
                      onClick={() => handlePrSelect(pr)}
                      onMouseEnter={() => setHoveredPr(pr.number)}
                      onMouseLeave={() => setHoveredPr(null)}
                      className="w-full text-left px-3 py-2 rounded-md transition-colors"
                      style={{
                        backgroundColor: isHovered ? 'var(--color-bg-hover)' : 'transparent',
                      }}
                    >
                      <div className="flex items-start gap-2">
                        <span
                          className="shrink-0 mt-1 text-xs font-medium px-1.5 py-0.5 rounded"
                          style={{
                            backgroundColor: `var(--color-accent-${statusTone}-bg)`,
                            color: `var(--color-accent-${statusTone})`,
                          }}
                        >
                          {state.charAt(0).toUpperCase() + state.slice(1)}
                        </span>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-slate-200 truncate">
                            {pr.title}
                          </div>
                          <div className="text-xs text-slate-500 mt-0.5">
                            #{pr.number} · {t.linkPrModal.updated.replace('{time}', formatRelativeDate(pr.updatedAt))}
                            {pr.author && ` · ${pr.author}`}
                          </div>
                        </div>
                      </div>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        <div className="p-3 border-t border-slate-700 flex justify-end">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm font-medium text-slate-300 bg-slate-800 border border-slate-700 rounded-md hover:bg-slate-700 focus:outline-none focus:ring-2 focus:ring-slate-500"
          >
            {t.linkPrModal.cancel}
          </button>
        </div>
      </div>
    </div>
  )
}
