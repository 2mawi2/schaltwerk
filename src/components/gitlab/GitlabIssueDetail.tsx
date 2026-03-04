import { VscArrowLeft, VscLinkExternal } from 'react-icons/vsc'
import type { GitlabIssueDetails } from '../../types/gitlabTypes'
import { useTranslation } from '../../common/i18n'
import { theme } from '../../common/theme'
import { formatRelativeDate } from '../../utils/time'
import { logger } from '../../utils/logger'
import { GitlabLabelChip } from './GitlabLabelChip'

interface GitlabIssueDetailProps {
  details: GitlabIssueDetails
  onBack: () => void
}

function StateBadge({ state }: { state: string }) {
  const { t } = useTranslation()
  const isOpen = state === 'opened'
  const label = isOpen ? t.gitlabIssueTab.opened : t.gitlabIssueTab.closed
  const color = isOpen ? 'var(--color-accent-green)' : 'var(--color-accent-red)'

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: theme.fontSize.caption,
        fontWeight: 600,
        color,
        backgroundColor: isOpen ? 'var(--color-accent-green-bg)' : 'var(--color-accent-red-bg)',
        borderRadius: 9999,
        padding: '2px 8px',
        lineHeight: theme.lineHeight.badge,
      }}
    >
      {label}
    </span>
  )
}


export function GitlabIssueDetail({ details, onBack }: GitlabIssueDetailProps) {
  const { t } = useTranslation()
  const userNotes = details.notes.filter(n => n.body && n.body.trim().length > 0)

  const handleOpenInGitlab = () => {
    try {
      window.open(details.url, '_blank', 'noopener,noreferrer')
    } catch (err) {
      logger.warn('[GitlabIssueDetail] Failed to open URL', err)
    }
  }

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
          title={t.gitlabIssueTab.back}
        >
          <VscArrowLeft className="w-3.5 h-3.5" />
          <span>{t.gitlabIssueTab.back}</span>
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
          title={t.gitlabIssueTab.openInGitlab}
        >
          <VscLinkExternal className="w-3 h-3" />
          <span>{t.gitlabIssueTab.openInGitlab}</span>
        </button>
      </div>

      <div className="flex-1 overflow-y-auto px-3 py-3">
        <div className="flex items-start gap-2 mb-3">
          <StateBadge state={details.state} />
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
          #{details.iid} {details.title}
        </h3>

        {details.labels.length > 0 && (
          <div className="flex flex-wrap gap-1 mb-3">
            {details.labels.map(label => (
              <GitlabLabelChip key={label} label={label} />
            ))}
          </div>
        )}

        {details.description && (
          <div className="mb-4">
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
              {t.gitlabIssueTab.description}
            </div>
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
          <div
            style={{
              fontSize: theme.fontSize.caption,
              fontWeight: 600,
              color: 'var(--color-text-muted)',
              marginBottom: 6,
              textTransform: 'uppercase',
              letterSpacing: '0.05em',
            }}
          >
            {t.gitlabIssueTab.notes} ({userNotes.length})
          </div>

          {userNotes.length === 0 ? (
            <div
              style={{
                fontSize: theme.fontSize.caption,
                color: 'var(--color-text-muted)',
                fontStyle: 'italic',
              }}
            >
              {t.gitlabIssueTab.noNotes}
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
      </div>
    </div>
  )
}
