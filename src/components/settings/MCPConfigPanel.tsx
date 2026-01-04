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
      setSuccess('Command copied to clipboard!')
      setTimeout(() => setSuccess(null), 3000)
    }
  }

  const removeMCP = async () => {
    setLoading(true)
    try {
      await invoke(TauriCommands.RemoveMcpForProject, { projectPath, client: agent })
      setSuccess('MCP configuration removed')
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
          <h3 className="text-sm font-medium text-slate-200">{t.settings.mcp.title}</h3>
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
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 focus:ring-cyan-400 focus:ring-offset-0"
              style={{
                color: 'var(--color-accent-blue-dark)',
              }}
            />
             <span className="text-xs text-slate-400">
               {requiresGlobalConfig ? t.settings.mcp.enableMcpGlobal : t.settings.mcp.enableMcp}
             </span>
          </label>
        </div>
         <p className="text-xs text-slate-400">
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
         <div className="p-3 bg-slate-800/30 border border-slate-700 rounded text-slate-400 text-xs">
           {t.settings.mcp.enableMcpHint.replace('{agent}', agentLabel)}
         </div>
       )}

      {mcpEnabled && (
        <>
          {loading && (
            <div className="flex items-center justify-center py-4">
              <AnimatedText text="configuring" size="sm" />
            </div>
          )}

          {error && (
            <div className="p-3 bg-red-900/20 border border-red-800 rounded text-red-400 text-xs">
              {error}
            </div>
          )}

          {success && (
            <div className="space-y-3">
              <div className="p-3 bg-green-900/20 border border-green-800 rounded text-green-400 text-xs">
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
              <div className="space-y-2 p-3 bg-slate-800/50 rounded border border-slate-700">
                 <div className="flex items-center justify-between text-xs">
                   <span className="text-slate-400">{t.settings.mcp.cliLabel.replace('{agent}', agentLabel)}</span>
                   <span className={status.cli_available ? 'text-green-400' : 'text-amber-400'}>
                     {status.cli_available ? t.settings.mcp.available : t.settings.mcp.notFound}
                   </span>
                 </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{t.settings.mcp.serverLabel}</span>
                  <span className="text-slate-300">
                    {status.is_embedded ? t.settings.mcp.embedded : t.settings.mcp.development}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{t.settings.mcp.nodeRuntime}</span>
                  <span className={nodeAvailable ? 'text-green-400' : 'text-amber-400'}>
                    {nodeAvailable ? t.settings.mcp.available : t.settings.mcp.notFound}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{t.settings.mcp.configuration}</span>
                  <span className={status.is_configured ? 'text-green-400' : 'text-amber-400'}>
                    {status.is_configured ? t.settings.mcp.configured : t.settings.mcp.notConfigured}
                  </span>
                </div>

                {status.is_configured && (
                  <div className="pt-2 border-t border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">{t.settings.mcp.serverLocation}</div>
                    <div className="text-xs text-slate-300 font-mono break-all">
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
                       className="px-3 py-1 bg-green-800 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed border border-green-700 rounded text-sm transition-colors text-green-200"
                     >
                       {requiresGlobalConfig ? t.settings.mcp.reconfigureMcpGlobal : t.settings.mcp.reconfigureMcp}
                     </button>
                  ) : (
                    <button
                      onClick={() => { void configureMCP() }}
                       disabled={loading}
                         className="px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors"
                         style={{
                           backgroundColor: 'var(--color-cyan-800)',
                           borderColor: 'var(--color-accent-blue-border)',
                           color: 'var(--color-accent-blue-light)',
                         }}
                         onMouseEnter={(e) => {
                           e.currentTarget.style.backgroundColor = 'var(--color-cyan-700)';
                         }}
                         onMouseLeave={(e) => {
                           e.currentTarget.style.backgroundColor = 'var(--color-cyan-800)';
                         }}
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
                           className="px-3 py-1 border rounded text-sm transition-colors inline-block"
                           style={{
                             backgroundColor: 'var(--color-cyan-800)',
                             borderColor: 'var(--color-accent-blue-border)',
                             color: 'var(--color-accent-blue-light)',
                           }}
                           onMouseEnter={(e) => {
                             (e.target as HTMLElement).style.backgroundColor = 'var(--color-cyan-700)';
                           }}
                           onMouseLeave={(e) => {
                             (e.target as HTMLElement).style.backgroundColor = 'var(--color-cyan-800)';
                           }}
                        >
                         {t.settings.mcp.installClaudeFirst}
                       </a>
                     ) : agent === 'codex' ? (
                       <div className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-300 inline-block">
                         {t.settings.mcp.installCodexFirst}
                       </div>
                     ) : agent === 'opencode' ? (
                        <a
                          href="https://opencode.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1 bg-cyan-800 hover:bg-cyan-700 border border-cyan-700 rounded text-sm transition-colors text-cyan-200 inline-block"
                       >
                         {t.settings.mcp.installOpencodeFirst}
                       </a>
                     ) : agent === 'amp' ? (
                       <div className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-300 inline-block">
                         {t.settings.mcp.installAmpFirst}
                       </div>
                     ) : (
                       <div className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-300 inline-block">
                         {t.settings.mcp.installDroidFirst}
                       </div>
                     )}
                  </>
                )}

                {status.is_configured && (
                  <button
                    onClick={() => { void removeMCP() }}
                    disabled={loading}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 rounded text-sm transition-colors text-slate-400"
                  >
                    {t.settings.common.remove}
                  </button>
                )}
                
                <button
                  onClick={() => setShowManualSetup(!showManualSetup)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-sm transition-colors text-slate-400"
                >
                  {showManualSetup ? t.settings.mcp.hide : t.settings.mcp.manualSetup}
                </button>
              </div>

              {showManualSetup && (
                <div className="p-3 bg-slate-900 border border-slate-700 rounded">
                   <p className="text-xs text-slate-400 mb-2">
                     {agent === 'codex' ? 'Add to ~/.codex/config.toml:' : agent === 'opencode' ? 'Add to opencode.json:' : agent === 'amp' ? 'Add to ~/.config/amp/settings.json:' : agent === 'droid' ? 'Add to ~/.factory/mcp.json:' : t.settings.mcp.manualSetupPrefix}
                   </p>
                  
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="p-2 bg-slate-950 border border-slate-800 rounded overflow-x-auto">
                         <code className="text-xs text-slate-300 whitespace-nowrap block font-mono">
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
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition-colors text-slate-400 flex-shrink-0 self-start"
                      title="Copy command"
                    >
                      {t.settings.common.copy}
                    </button>
                  </div>
                  
                   <p className="text-xs text-slate-500 mt-2 italic">
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
