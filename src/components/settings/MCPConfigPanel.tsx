import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'
import { useTranslation } from '../../common/i18n/useTranslation'

interface MCPStatus {
  mcp_server_path: string
  is_embedded: boolean
  cli_available: boolean
  node_available?: boolean
  node_command?: string
  client: 'claude' | 'codex' | 'opencode' | 'amp' | 'droid'
  is_configured: boolean
  setup_command: string
  project_path: string
}

interface Props {
   projectPath: string
   agent: 'claude' | 'codex' | 'opencode' | 'amp' | 'droid'
 }

function getAgentDisplayName(agent: Props['agent']): string {
  switch (agent) {
    case 'claude':
      return 'Claude Code'
    case 'codex':
      return 'Codex'
    case 'opencode':
      return 'OpenCode'
    case 'amp':
      return 'Amp'
    case 'droid':
      return 'Droid'
    default:
      return agent
  }
}

function NodeRequiredNotice({ agent, t }: { agent: Props['agent']; t: ReturnType<typeof useTranslation>['t'] }) {
  const agentLabel = getAgentDisplayName(agent)
  return (
    <div
      className="p-3 border rounded text-xs space-y-2"
      style={{
        backgroundColor: 'var(--color-accent-amber-bg)',
        borderColor: 'var(--color-accent-amber-border)',
        color: 'var(--color-text-primary)',
      }}
    >
      <div className="font-medium" style={{ color: 'var(--color-accent-amber-light)' }}>
        {t.settings.mcp.nodeRequired}
      </div>
      <div>{t.settings.mcp.nodeRequiredDesc}</div>
      <div>
        {t.settings.mcp.installNodeDesc.replace('{agent}', agentLabel)}
      </div>
      <a
        href="https://nodejs.org/en/download"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block underline"
        style={{ color: 'var(--color-accent-amber-light)' }}
      >
        {t.settings.mcp.downloadNode}
      </a>
    </div>
  )
}

export function MCPConfigPanel({ projectPath, agent }: Props) {
  const { t } = useTranslation()
  const [status, setStatus] = useState<MCPStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showManualSetup, setShowManualSetup] = useState(false)
  const [mcpEnabled, setMcpEnabled] = useState(false)
  const agentLabel = getAgentDisplayName(agent)
  const nodeAvailable = status?.node_available ?? true
  const nodeCommand = status?.node_command ?? 'node'
  const requiresGlobalConfig = agent === 'codex' || agent === 'amp' || agent === 'droid'

  const loadStatus = useCallback(async () => {
    try {
      const mcpStatus = await invoke<MCPStatus>(TauriCommands.GetMcpStatus, { projectPath, client: agent })
      setStatus(mcpStatus)
    } catch (e) {
      logger.error(`Failed to load MCP status for ${agent}`, e)
      setError(String(e))
    }
  }, [projectPath, agent])

  useEffect(() => {
    void loadStatus()
  }, [projectPath, loadStatus])

  useEffect(() => {
    if (status?.is_configured) {
      setMcpEnabled(true)
    }
  }, [status])

  const configureMCP = async () => {
    setLoading(true)
    setError(null)
    setSuccess(null)
    
    try {
      const result = await invoke<string>(TauriCommands.ConfigureMcpForProject, { projectPath, client: agent })
      
      // Add .mcp.json to gitignore if needed (Claude only, others use global config)
      if (agent === 'claude') {
        try {
          await invoke<string>(TauriCommands.EnsureMcpGitignored, { projectPath })
        } catch (gitignoreError) {
          logger.warn('Failed to update gitignore:', gitignoreError)
          // Don't fail the whole operation if gitignore fails
        }
        setSuccess(`${result}. Added .mcp.json to project and .gitignore.`)
      } else {
        setSuccess(result)
      }
      // Reload status
      await loadStatus()
    } catch (e) {
      logger.error(`Failed to configure MCP for ${agent}`, e)
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  const copyCommand = async () => {
    if (status) {
      await navigator.clipboard.writeText(status.setup_command)
      setSuccess(t.mcpMessages.commandCopied)
      setTimeout(() => setSuccess(null), 3000)
    }
  }

  const removeMCP = async () => {
    setLoading(true)
    try {
      await invoke(TauriCommands.RemoveMcpForProject, { projectPath, client: agent })
      setSuccess(t.mcpMessages.configurationRemoved)
      await loadStatus()
    } catch (e) {
      logger.error(`Failed to remove MCP configuration for ${agent}`, e)
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-text-primary">{t.settings.mcp.title}</h3>
              <label className="flex items-center gap-2">
                <input
                  type="checkbox"
                  checked={mcpEnabled}
                  onChange={(e) => {
                    setMcpEnabled(e.target.checked)
                    if (!e.target.checked && status?.is_configured) {
                      void removeMCP()
                    }
                  }}
              className="w-4 h-4 rounded border-border-strong bg-bg-tertiary focus:ring-accent-blue focus:ring-offset-0"
              style={{
                color: 'var(--color-accent-blue-dark)',
              }}
            />
             <span className="text-xs text-text-tertiary">
               {requiresGlobalConfig ? t.settings.mcp.enableMcpGlobal : t.settings.mcp.enableMcp}
             </span>
          </label>
        </div>
         <p className="text-xs text-text-tertiary">
           {agent === 'claude'
             ? t.settings.mcp.claudeDesc.replace('{agent}', agentLabel)
             : agent === 'codex'
             ? t.settings.mcp.codexDesc.replace('{agent}', agentLabel)
             : agent === 'opencode'
             ? t.settings.mcp.opencodeDesc.replace('{agent}', agentLabel)
             : agent === 'amp'
             ? t.settings.mcp.ampDesc.replace('{agent}', agentLabel)
             : t.settings.mcp.droidDesc.replace('{agent}', agentLabel)}
         </p>
      </div>

       {!mcpEnabled && (
         <div className="p-3 bg-bg-tertiary/30 border border-border-subtle rounded text-text-tertiary text-xs">
           {t.settings.mcp.enableMcpHint.replace('{agent}', agentLabel)}
         </div>
       )}

      {mcpEnabled && (
        <>
          {loading && (
            <div className="flex items-center justify-center py-4">
              <AnimatedText text={t.mcpMessages.configuring} size="sm" />
            </div>
          )}

          {error && (
            <div className="p-3 rounded text-xs"
                 style={{
                   backgroundColor: 'var(--color-accent-red-bg)',
                   border: '1px solid var(--color-accent-red-border)',
                   color: 'var(--color-accent-red-light)',
                 }}>
              {error}
            </div>
          )}

          {success && (
            <div className="space-y-3">
              <div className="p-3 rounded text-xs"
                   style={{
                     backgroundColor: 'var(--color-accent-green-bg)',
                     border: '1px solid var(--color-accent-green-border)',
                     color: 'var(--color-accent-green-light)',
                   }}>
                {success}
              </div>
              
              <div className="p-3 rounded text-xs"
                   style={{
                     backgroundColor: 'var(--color-accent-blue-bg)',
                     borderColor: 'var(--color-accent-blue-border)',
                     color: 'var(--color-accent-blue)',
                   }}>
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                 <div>
                    <div className="font-medium mb-1">{t.settings.mcp.nextSteps}</div>
                    <div>• {t.settings.mcp.nextStepsItems.restart.replace('{agent}', agentLabel)}</div>
                    <div>• {t.settings.mcp.nextStepsItems.resetButton}</div>
                    <div>• {t.settings.mcp.nextStepsItems.available.replace('{agent}', agentLabel)}</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {status && !nodeAvailable && (
            <NodeRequiredNotice agent={agent} t={t} />
          )}

          {status && (
            <>
              <div className="space-y-2 p-3 bg-bg-elevated/50 rounded border border-border-subtle">
                 <div className="flex items-center justify-between text-xs">
                   <span className="text-text-tertiary">{t.settings.mcp.cliLabel.replace('{agent}', agentLabel)}</span>
                   <span style={{ color: status.cli_available ? 'var(--color-accent-green-light)' : 'var(--color-accent-amber-light)' }}>
                     {status.cli_available ? t.settings.mcp.available : t.settings.mcp.notFound}
                   </span>
                 </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">{t.settings.mcp.serverLabel}</span>
                  <span className="text-text-secondary">
                    {status.is_embedded ? t.settings.mcp.embedded : t.settings.mcp.development}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">{t.settings.mcp.nodeRuntime}</span>
                  <span style={{ color: nodeAvailable ? 'var(--color-accent-green-light)' : 'var(--color-accent-amber-light)' }}>
                    {nodeAvailable ? t.settings.mcp.available : t.settings.mcp.notFound}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-text-tertiary">{t.settings.mcp.configuration}</span>
                  <span style={{ color: status.is_configured ? 'var(--color-accent-green-light)' : 'var(--color-accent-amber-light)' }}>
                    {status.is_configured ? t.settings.mcp.configured : t.settings.mcp.notConfigured}
                  </span>
                </div>

                {status.is_configured && (
                  <div className="pt-2 border-t border-border-subtle">
                    <div className="text-xs text-text-muted mb-1">{t.settings.mcp.serverLocation}</div>
                    <div className="text-xs text-text-secondary font-mono break-all">
                      {status.mcp_server_path}
                    </div>
                  </div>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {status.cli_available ? (
                  status.is_configured ? (
                    <button
                      onClick={() => { void configureMCP() }}
                       disabled={loading}
                       className="settings-btn-success px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                     >
                       {requiresGlobalConfig ? t.settings.mcp.reconfigureMcpGlobal : t.settings.mcp.reconfigureMcp}
                     </button>
                  ) : (
                    <button
                      onClick={() => { void configureMCP() }}
                       disabled={loading}
                         className="settings-btn-success px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                     >
                       {agent === 'codex' || agent === 'amp' || agent === 'droid' ? t.settings.mcp.enableMcpGlobalBtn : t.settings.mcp.configureMcpProject}
                     </button>
                  )
                ) : (
                  <>
                     {agent === 'claude' ? (
                         <a
                           href="https://claude.ai/download"
                           target="_blank"
                           rel="noopener noreferrer"
                           className="px-3 py-1 rounded text-sm transition-colors inline-block"
                           style={{
                             backgroundColor: 'var(--color-accent-green-bg)',
                             border: '1px solid var(--color-accent-green-border)',
                             color: 'var(--color-accent-green-light)',
                           }}
                           onMouseEnter={(e) => {
                             (e.target as HTMLElement).style.backgroundColor = 'var(--color-accent-green-dark)';
                           }}
                           onMouseLeave={(e) => {
                             (e.target as HTMLElement).style.backgroundColor = 'var(--color-accent-green-bg)';
                           }}
                        >
                         {t.settings.mcp.installClaudeFirst}
                       </a>
                     ) : agent === 'codex' ? (
                       <div className="px-3 py-1 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-secondary inline-block">
                         {t.settings.mcp.installCodexFirst}
                       </div>
                     ) : agent === 'opencode' ? (
                        <a
                          href="https://opencode.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1 rounded text-sm transition-colors inline-block"
                          style={{
                            backgroundColor: 'var(--color-accent-blue-bg)',
                            border: '1px solid var(--color-accent-blue-border)',
                            color: 'var(--color-accent-blue-light)',
                          }}
                          onMouseEnter={(e) => {
                            (e.target as HTMLElement).style.backgroundColor = 'var(--color-accent-blue-dark)';
                          }}
                          onMouseLeave={(e) => {
                            (e.target as HTMLElement).style.backgroundColor = 'var(--color-accent-blue-bg)';
                          }}
                       >
                         {t.settings.mcp.installOpencodeFirst}
                       </a>
                     ) : agent === 'amp' ? (
                       <div className="px-3 py-1 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-secondary inline-block">
                         {t.settings.mcp.installAmpFirst}
                       </div>
                     ) : (
                       <div className="px-3 py-1 bg-bg-tertiary border border-border-subtle rounded text-sm text-text-secondary inline-block">
                         {t.settings.mcp.installDroidFirst}
                       </div>
                     )}
                  </>
                )}

                {status.is_configured && (
                  <button
                    onClick={() => { void removeMCP() }}
                    disabled={loading}
                    className="settings-btn px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm"
                  >
                    {t.settings.common.remove}
                  </button>
                )}
                
                <button
                  onClick={() => setShowManualSetup(!showManualSetup)}
                  className="settings-btn px-3 py-1 rounded text-sm"
                >
                  {showManualSetup ? t.settings.mcp.hide : t.settings.mcp.manualSetup}
                </button>
              </div>

              {showManualSetup && (
                <div className="p-3 bg-bg-tertiary border border-border-subtle rounded">
                   <p className="text-xs text-text-tertiary mb-2">
                     {agent === 'codex' ? 'Add to ~/.codex/config.toml:' : agent === 'opencode' ? 'Add to opencode.json:' : agent === 'amp' ? 'Add to ~/.config/amp/settings.json:' : agent === 'droid' ? 'Add to ~/.factory/mcp.json:' : t.settings.mcp.manualSetupPrefix}
                   </p>

                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="p-2 bg-bg-primary border border-border-default rounded overflow-x-auto">
                         <code className="text-xs text-text-secondary whitespace-nowrap block font-mono">
                           {agent === 'codex'
                             ? (<>
                                 [mcp_servers.schaltwerk]
                                 <br />command = "{nodeCommand}"
                                 <br />args = ["{status.mcp_server_path}"]
                               </>)
                             : agent === 'opencode'
                             ? (<>
                                 {`{\n  "mcp": {\n    "schaltwerk": {\n      "type": "local",\n      "command": ["node", "${status.mcp_server_path}"],\n      "enabled": true\n    }\n  }\n}`}
                               </>)
                             : agent === 'amp'
                             ? (<>
                                 {`"amp.mcpServers": {\n  "schaltwerk": {\n    "command": "node",\n    "args": ["${status.mcp_server_path}"]\n  }\n}`}
                               </>)
                             : agent === 'droid'
                             ? (<>
                                 {`{\n  "mcpServers": {\n    "schaltwerk": {\n      "type": "stdio",\n      "command": "node",\n      "args": ["${status.mcp_server_path}"]\n    }\n  }\n}`}
                               </>)
                             : (<>
                                 {agent} mcp add --transport stdio --scope project schaltwerk node "{status.mcp_server_path}"
                               </>)}
                         </code>
                      </div>
                    </div>
                    
                    <button
                      onClick={() => { void copyCommand() }}
                      className="settings-btn px-2 py-1 rounded text-xs flex-shrink-0 self-start"
                      title={t.mcpMessages.copyCommand}
                    >
                      {t.settings.common.copy}
                    </button>
                  </div>
                  
                   <p className="text-xs text-text-muted mt-2 italic">
                     {agent === 'codex'
                       ? t.settings.mcp.codexConfigNote
                       : agent === 'opencode'
                       ? t.settings.mcp.opencodeConfigNote
                       : agent === 'amp'
                       ? t.settings.mcp.ampConfigNote
                       : agent === 'droid'
                       ? t.settings.mcp.droidConfigNote
                       : t.settings.mcp.claudeConfigNote}
                   </p>
                </div>
              )}
            </>
          )}
        </>
      )}
    </div>
  )
}
