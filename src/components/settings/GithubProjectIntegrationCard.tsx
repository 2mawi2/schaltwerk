import { useEffect, useMemo, useState } from 'react'
import { FaGithub } from 'react-icons/fa'
import { VscRefresh, VscWarning, VscCheck, VscInfo } from 'react-icons/vsc'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'
import { logger } from '../../utils/logger'
import { getPlatform } from '../../utils/platform'

interface GithubProjectIntegrationCardProps {
  projectPath: string
  onNotify: (message: string, tone: 'success' | 'error' | 'info') => void
}

const formatError = (error: unknown): string => {
  if (error instanceof Error) return error.message
  if (typeof error === 'string') return error
  try {
    return JSON.stringify(error)
  } catch {
    return String(error)
  }
}

export function GithubProjectIntegrationCard({ projectPath, onNotify }: GithubProjectIntegrationCardProps) {
  const github = useGithubIntegrationContext()
  const [feedback, setFeedback] = useState<{ tone: 'info' | 'success' | 'error'; title: string; description?: string } | null>(null)
  const [platform, setPlatform] = useState<'macos' | 'linux' | 'windows' | null>(null)

  useEffect(() => {
    void getPlatform().then(setPlatform).catch((err) => {
      logger.error('Failed to detect platform', err)
    })
  }, [])

  const formatFeedbackLines = useMemo(() => {
    return (description?: string): string[] => {
      if (!description) return []
      const collapsed = description.replace(/\r?\n/g, ' ').replace(/\s+/g, ' ').trim()
      const withManualBreaks = collapsed
        .replace(/To authenticate:\s*/i, 'To authenticate:\n')
        .replace(/\s*(\d\.)\s*/g, (_, group) => `\n${group} `)
      return withManualBreaks.split('\n').map((line) => line.trim()).filter(Boolean)
    }
  }, [])

  const installed = github.status?.installed ?? false
  const authenticated = installed && (github.status?.authenticated ?? false)
  const repository = github.status?.repository ?? null

  const authenticateLabel = github.isAuthenticating ? 'Authenticating…' : 'Authenticate'
  const connectLabel = github.isConnecting ? 'Connecting…' : 'Connect project'
  const canConnectProject = installed && authenticated && !repository && Boolean(projectPath)

  type StatusTone = 'info' | 'warning' | 'danger' | 'success'

  const ghInstallCommand = useMemo(() => {
    switch (platform) {
      case 'windows':
        return 'winget install GitHub.cli'
      case 'linux':
        return 'see https://github.com/cli/cli/blob/trunk/docs/install_linux.md'
      case 'macos':
        return 'brew install gh'
      default:
        return 'see https://cli.github.com'
    }
  }, [platform])

  const statusDetails = useMemo((): { tone: StatusTone; title: string; description: string } => {
    if (!installed) {
      return {
        tone: 'danger',
        title: 'GitHub CLI not installed',
        description: `Install the GitHub CLI (${ghInstallCommand}) to enable pull request automation.`,
      }
    }
    if (!authenticated) {
      return {
        tone: 'warning',
        title: 'GitHub CLI authentication required',
        description: 'Run gh auth login in your terminal, then click Authenticate or Refresh to sync Schaltwerk.',
      }
    }
    if (!projectPath) {
      return {
        tone: 'info',
        title: 'Open a project to finish setup',
        description: 'Open a Schaltwerk project so GitHub integration can connect it to the right repository.',
      }
    }
    if (repository) {
      return {
        tone: 'success',
        title: `Connected to ${repository.nameWithOwner}`,
        description: `Default branch ${repository.defaultBranch}. Reviewed sessions will target this repository.`,
      }
    }
    return {
      tone: 'info',
      title: 'Ready to connect project',
      description: 'Connect this project so reviewed sessions push to the correct GitHub repository.',
    }
  }, [installed, authenticated, projectPath, repository])

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

  const handleAuthenticate = async () => {
    try {
      const result = await github.authenticate()
      const login = result.userLogin || github.status?.userLogin || ''
      setFeedback({
        tone: 'success',
        title: login ? `Authenticated as ${login}` : 'GitHub authentication complete',
        description: 'GitHub CLI access is now ready. You can connect this project or refresh status anytime.',
      })
    } catch (error) {
      logger.error('GitHub CLI authentication failed', error)
      const message = formatError(error)
      setFeedback({
        tone: 'error',
        title: 'Authentication failed',
        description: message,
      })
    }
  }

  const handleConnect = async () => {
    if (!canConnectProject) {
      onNotify('Open a project and authenticate to connect it to GitHub.', 'info')
      return
    }
    try {
      const info = await github.connectProject()
      onNotify(`Connected ${info.nameWithOwner} • default ${info.defaultBranch}`, 'success')
    } catch (error) {
      logger.error('Failed to connect GitHub project', error)
      onNotify(`Failed to connect project: ${formatError(error)}`, 'error')
    }
  }

  const handleRefresh = async () => {
    try {
      await github.refreshStatus()
      onNotify('GitHub status refreshed', 'info')
    } catch (error) {
      logger.error('Failed to refresh GitHub status', error)
      onNotify(`Failed to refresh status: ${formatError(error)}`, 'error')
    }
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
            <FaGithub className="text-base" />
            <span>GitHub Integration</span>
          </div>
          <div
            data-testid="github-auth-status"
            className="inline-flex rounded-md px-3 py-2 text-xs"
            style={{
              backgroundColor: tonePalette.bg,
              border: `1px solid ${tonePalette.border}`,
              color: 'var(--color-text-primary)',
              maxWidth: '360px',
            }}
          >
            <div className="flex items-start gap-2 text-left">
              <ToneIcon className="text-sm mt-[2px]" style={{ color: tonePalette.DEFAULT }} />
              <div className="space-y-1">
                <div className="font-medium" style={{ color: tonePalette.light }}>
                  {statusDetails.title}
                </div>
                <div className="text-[11px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                  {statusDetails.description}
                </div>
              </div>
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => { void handleAuthenticate() }}
            disabled={!installed || github.isAuthenticating}
            className="px-3 py-2 text-xs font-medium rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-accent-blue-bg)',
              border: '1px solid var(--color-accent-blue-border)',
              color: 'var(--color-accent-blue-light)',
            }}
          >
            {authenticateLabel}
          </button>
          <button
            onClick={() => { void handleConnect() }}
            disabled={!canConnectProject || github.isConnecting}
            className="px-3 py-2 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: 'var(--color-bg-hover)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
          >
            {connectLabel}
          </button>
          <button
            onClick={() => { void handleRefresh() }}
            className="px-3 py-2 text-xs font-medium rounded-md flex items-center gap-1 transition-colors"
            style={{
              backgroundColor: 'var(--color-bg-hover)',
              border: '1px solid var(--color-border-subtle)',
              color: 'var(--color-text-primary)',
            }}
          >
            <VscRefresh className="text-[13px]" />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      {feedback && (
        <div
          data-testid="github-auth-feedback"
          className="mt-3 inline-flex rounded-md px-3 py-2 text-xs"
          style={{
            backgroundColor:
              feedback.tone === 'success'
                ? 'var(--color-accent-green-bg)'
                : feedback.tone === 'error'
                  ? 'var(--color-accent-red-bg)'
                  : 'var(--color-accent-blue-bg)',
            border: `1px solid ${
              feedback.tone === 'success'
                ? 'var(--color-accent-green-border)'
                : feedback.tone === 'error'
                  ? 'var(--color-accent-red-border)'
                  : 'var(--color-accent-blue-border)'
            }`,
            color: 'var(--color-text-primary)',
            maxWidth: '380px',
          }}
        >
          <div className="flex items-start gap-2 text-left">
            {feedback.tone === 'success' ? (
              <VscCheck className="text-sm mt-[2px]" style={{ color: 'var(--color-accent-green)' }} />
            ) : feedback.tone === 'error' ? (
              <VscWarning className="text-sm mt-[2px]" style={{ color: 'var(--color-accent-red)' }} />
            ) : (
              <VscInfo className="text-sm mt-[2px]" style={{ color: 'var(--color-accent-blue)' }} />
            )}
            <div className="space-y-1">
              <div className="font-medium">{feedback.title}</div>
              {formatFeedbackLines(feedback.description).map((line, index) => (
                <div key={`${line}-${index}`} className="text-[11px] leading-snug" style={{ color: 'var(--color-text-secondary)' }}>
                  {line}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      <div className="mt-3 text-caption flex flex-wrap gap-x-6 gap-y-1" style={{ color: 'var(--color-text-secondary)' }}>
        <span>CLI installed: <strong>{installed ? 'Yes' : 'No'}</strong></span>
        <span>Authenticated: <strong>{authenticated ? 'Yes' : 'No'}</strong></span>
        <span>Project path: <strong>{projectPath || 'None'}</strong></span>
      </div>
    </div>
  )
}

export default GithubProjectIntegrationCard
