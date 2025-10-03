import { FaGithub } from 'react-icons/fa'
import { VscRefresh } from 'react-icons/vsc'
import { theme } from '../../common/theme'
import { useGithubIntegrationContext } from '../../contexts/GithubIntegrationContext'

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

  const installed = github.status?.installed ?? false
  const authenticated = installed && (github.status?.authenticated ?? false)
  const repository = github.status?.repository ?? null

  const authenticateLabel = github.isAuthenticating ? 'Authenticating…' : 'Authenticate'
  const connectLabel = github.isConnecting ? 'Connecting…' : 'Connect project'
  const canConnectProject = installed && authenticated && !repository && Boolean(projectPath)

  const statusMessage = !installed
    ? 'Install the GitHub CLI (brew install gh) to enable pull request automation.'
    : !authenticated
      ? 'Authenticate with the GitHub CLI so Schaltwerk can create pull requests for reviewed sessions.'
      : !projectPath
        ? 'Open a project to link it with GitHub.'
        : repository
          ? `Connected to ${repository.nameWithOwner} (default branch ${repository.defaultBranch}).`
          : 'Connect this project to its GitHub repository so reviewed sessions target the correct branch.'

  const handleAuthenticate = async () => {
    try {
      const result = await github.authenticate()
      const login = result.userLogin || github.status?.userLogin || ''
      onNotify(login ? `Authenticated as ${login}` : 'GitHub authentication complete', 'success')
    } catch (error) {
      onNotify(`GitHub authentication failed: ${formatError(error)}`, 'error')
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
      onNotify(`Failed to connect project: ${formatError(error)}`, 'error')
    }
  }

  const handleRefresh = async () => {
    try {
      await github.refreshStatus()
      onNotify('GitHub status refreshed', 'info')
    } catch (error) {
      onNotify(`Failed to refresh status: ${formatError(error)}`, 'error')
    }
  }

  return (
    <div
      className="p-4 rounded-lg border"
      style={{
        borderColor: theme.colors.border.subtle,
        backgroundColor: theme.colors.background.elevated,
        color: theme.colors.text.primary,
      }}
    >
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-body font-medium" style={{ color: theme.colors.text.primary }}>
            <FaGithub className="text-base" />
            <span>GitHub Integration</span>
          </div>
          <div className="text-caption" style={{ color: theme.colors.text.secondary }}>{statusMessage}</div>
          {repository && (
            <div className="text-caption" style={{ color: theme.colors.text.muted }}>
              Repo connected at {repository.nameWithOwner} (default {repository.defaultBranch})
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleAuthenticate}
            disabled={!installed || github.isAuthenticating}
            className="px-3 py-2 text-xs font-medium rounded-md transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
            style={{
              backgroundColor: theme.colors.accent.blue.bg,
              border: `1px solid ${theme.colors.accent.blue.border}`,
              color: theme.colors.accent.blue.light,
            }}
          >
            {authenticateLabel}
          </button>
          <button
            onClick={handleConnect}
            disabled={!canConnectProject || github.isConnecting}
            className="px-3 py-2 text-xs font-medium rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            style={{
              backgroundColor: theme.colors.background.hover,
              border: `1px solid ${theme.colors.border.subtle}`,
              color: theme.colors.text.primary,
            }}
          >
            {connectLabel}
          </button>
          <button
            onClick={handleRefresh}
            className="px-3 py-2 text-xs font-medium rounded-md flex items-center gap-1 transition-colors"
            style={{
              backgroundColor: theme.colors.background.hover,
              border: `1px solid ${theme.colors.border.subtle}`,
              color: theme.colors.text.primary,
            }}
          >
            <VscRefresh className="text-[13px]" />
            <span>Refresh</span>
          </button>
        </div>
      </div>
      <div className="mt-3 text-caption flex flex-wrap gap-x-6 gap-y-1" style={{ color: theme.colors.text.secondary }}>
        <span>CLI installed: <strong>{installed ? 'Yes' : 'No'}</strong></span>
        <span>Authenticated: <strong>{authenticated ? 'Yes' : 'No'}</strong></span>
        <span>Project path: <strong>{projectPath || 'None'}</strong></span>
      </div>
    </div>
  )
}

export default GithubProjectIntegrationCard
