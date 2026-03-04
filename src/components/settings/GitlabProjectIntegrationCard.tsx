import { useMemo, useState } from 'react'
import { FaGitlab } from 'react-icons/fa'
import { VscRefresh, VscWarning, VscCheck, VscInfo } from 'react-icons/vsc'
import { useTranslation } from '../../common/i18n/useTranslation'
import { useGitlabIntegrationContext } from '../../contexts/GitlabIntegrationContext'
import { GitlabSourcesSettings } from '../gitlab/GitlabSourcesSettings'
import { logger } from '../../utils/logger'

interface GitlabProjectIntegrationCardProps {
  onNotify: (message: string, tone: 'success' | 'error' | 'info') => void
}

export function GitlabProjectIntegrationCard({ onNotify }: GitlabProjectIntegrationCardProps) {
  const { t } = useTranslation()
  const gitlab = useGitlabIntegrationContext()
  const [isRefreshing, setIsRefreshing] = useState(false)

  const installed = gitlab.status?.installed ?? false
  const authenticated = installed && (gitlab.status?.authenticated ?? false)

  type StatusTone = 'info' | 'warning' | 'danger' | 'success'

  const statusDetails = useMemo((): { tone: StatusTone; title: string; description: string } => {
    if (!installed) {
      return {
        tone: 'danger',
        title: t.gitlabMenu.statusLabels.cliNotInstalled,
        description: t.gitlabMenu.installCliHint,
      }
    }
    if (!authenticated) {
      return {
        tone: 'warning',
        title: t.gitlabMenu.statusLabels.notAuthenticated,
        description: t.gitlabMenu.authHint,
      }
    }
    if (gitlab.sources.length > 0) {
      return {
        tone: 'success',
        title: t.gitlabMenu.statusLabels.sourcesCount.replace('{count}', String(gitlab.sources.length)),
        description: gitlab.sources.map((s) => s.label).join(', '),
      }
    }
    return {
      tone: 'info',
      title: t.gitlabMenu.statusLabels.configureGitlab,
      description: t.gitlabMenu.configureSources,
    }
  }, [installed, authenticated, gitlab.sources, t])

  const tonePalette =
    statusDetails.tone === 'success'
      ? {
        DEFAULT: 'var(--color-accent-green)',
        light: 'var(--color-accent-green-light)',
        bg: 'var(--color-accent-green-bg)',
        border: 'var(--color-accent-green-border)',
      }
      : statusDetails.tone === 'danger'
        ? {
          DEFAULT: 'var(--color-accent-red)',
          light: 'var(--color-accent-red-light)',
          bg: 'var(--color-accent-red-bg)',
          border: 'var(--color-accent-red-border)',
        }
        : statusDetails.tone === 'warning'
          ? {
            DEFAULT: 'var(--color-accent-amber)',
            light: 'var(--color-accent-amber-light)',
            bg: 'var(--color-accent-amber-bg)',
            border: 'var(--color-accent-amber-border)',
          }
          : {
            DEFAULT: 'var(--color-accent-blue)',
            light: 'var(--color-accent-blue-light)',
            bg: 'var(--color-accent-blue-bg)',
            border: 'var(--color-accent-blue-border)',
          }

  const ToneIcon =
    statusDetails.tone === 'success'
      ? VscCheck
      : statusDetails.tone === 'danger' || statusDetails.tone === 'warning'
        ? VscWarning
        : VscInfo

  const handleRefresh = async () => {
    setIsRefreshing(true)
    try {
      await gitlab.refreshStatus()
      onNotify('GitLab status refreshed', 'info')
    } catch (error) {
      logger.error('Failed to refresh GitLab status', error)
      onNotify('Failed to refresh GitLab status', 'error')
    } finally {
      setIsRefreshing(false)
    }
  }

  const handleSaveSources = async (sources: Parameters<typeof gitlab.saveSources>[0]) => {
    await gitlab.saveSources(sources)
    onNotify('GitLab sources saved', 'success')
  }

  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        borderColor: 'var(--color-border-subtle)',
        backgroundColor: 'var(--color-bg-elevated)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-body font-medium" style={{ color: 'var(--color-text-primary)' }}>
            <FaGitlab className="text-body-large" />
            <span>GitLab</span>
          </div>
          <div
            className="inline-flex rounded-md px-3 py-2 text-caption"
            style={{
              backgroundColor: tonePalette.bg,
              border: `1px solid ${tonePalette.border}`,
              color: 'var(--color-text-primary)',
              maxWidth: '360px',
            }}
          >
            <div className="flex items-start gap-2 text-left">
              <ToneIcon className="text-body mt-[2px]" style={{ color: tonePalette.DEFAULT }} />
              <div className="space-y-1">
                <div className="font-medium" style={{ color: tonePalette.light }}>
                  {statusDetails.title}
                </div>
                <div className="text-caption leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                  {statusDetails.description}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { void handleRefresh() }}
            disabled={isRefreshing}
            className="settings-btn px-3 py-2 text-caption font-medium rounded-md flex items-center gap-1 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <VscRefresh className="text-label" />
            <span>{t.settings.common.refresh}</span>
          </button>
        </div>
      </div>
      <div className="mt-3 text-caption flex flex-wrap gap-x-6 gap-y-1" style={{ color: 'var(--color-text-secondary)' }}>
        <span>glab installed: <strong>{installed ? t.settings.common.yes : t.settings.common.no}</strong></span>
        <span>Authenticated: <strong>{authenticated ? t.settings.common.yes : t.settings.common.no}</strong></span>
        <span>Sources: <strong>{gitlab.sources.length}</strong></span>
      </div>
      <div className="mt-4 pt-4" style={{ borderTop: '1px solid var(--color-border-subtle)' }}>
        <GitlabSourcesSettings sources={gitlab.sources} onSave={handleSaveSources} />
      </div>
    </div>
  )
}
