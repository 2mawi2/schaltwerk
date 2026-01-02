import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { TauriCommands } from '../../common/tauriCommands'
import { logger } from '../../utils/logger'

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

function NodeRequiredNotice({ agent }: { agent: Props['agent'] }) {
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
        Node.js required
      </div>
      <div>Node.js is required to run the Schaltwerk MCP server.</div>
      <div>
        Install Node.js and restart {getAgentDisplayName(agent)} to enable MCP tools.
      </div>
      <a
        href="https://nodejs.org/en/download"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-block underline"
        style={{ color: 'var(--color-accent-amber-light)' }}
      >
        Download Node.js
      </a>
    </div>
  )
}

export function MCPConfigPanel({ projectPath, agent }: Props) {
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
          <h3 className="text-sm font-medium text-secondary">MCP Server Configuration</h3>
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
              className="w-4 h-4 rounded border-subtle bg-elevated focus:ring-accent-blue focus:ring-offset-0"
              style={{
                color: 'var(--color-accent-blue-dark)',
              }}
            />
             <span className="text-xs text-tertiary">
               {requiresGlobalConfig ? 'Enable MCP (global)' : 'Enable MCP'}
             </span>
          </label>
        </div>
         <p className="text-xs text-tertiary">
           {agent === 'claude'
             ? `Allow ${agentLabel} to control Schaltwerk sessions in this project via MCP.`
             : agent === 'codex'
             ? `Enable ${agentLabel} to control Schaltwerk sessions via a global MCP entry in ~/.codex/config.toml. The server is project-aware and routes by your current repo.`
             : agent === 'opencode'
             ? `Enable ${agentLabel} to control Schaltwerk sessions via MCP configuration. The server is project-aware and routes by your current repo.`
             : agent === 'amp'
             ? `Enable ${agentLabel} to control Schaltwerk sessions via a global MCP entry in ~/.config/amp/settings.json. The server is project-aware and routes by your current repo.`
             : `Enable ${agentLabel} to control Schaltwerk sessions via a global MCP entry in ~/.factory/mcp.json. The server is project-aware and routes by your current repo.`}
         </p>
      </div>

       {!mcpEnabled && (
         <div className="p-3 bg-elevated/30 border border-subtle rounded text-tertiary text-xs">
           Enable MCP configuration to allow {agentLabel} to manage sessions in this project.
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
            <div className="p-3 border rounded text-xs"
                 style={{
                   backgroundColor: 'var(--color-accent-red-bg)',
                   borderColor: 'var(--color-accent-red-border)',
                   color: 'var(--color-accent-red)',
                 }}>
              {error}
            </div>
          )}

          {success && (
            <div className="space-y-3">
              <div className="p-3 border rounded text-xs"
                   style={{
                     backgroundColor: 'var(--color-accent-green-bg)',
                     borderColor: 'var(--color-accent-green-border)',
                     color: 'var(--color-accent-green)',
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
                    <div className="font-medium mb-1">Next Steps:</div>
                    <div>• Restart {agentLabel} to load the MCP server</div>
                    <div>• Or click the reset button (shown above) in the orchestrator terminal</div>
                    <div>• The MCP server will then be available for all {agentLabel} sessions in this project</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {status && !nodeAvailable && (
            <NodeRequiredNotice agent={agent} />
          )}

          {status && (
            <>
              <div className="space-y-2 p-3 bg-elevated/50 rounded border border-subtle">
                 <div className="flex items-center justify-between text-xs">
                   <span className="text-tertiary">{agentLabel} CLI:</span>
                   <span style={{
                     color: status.cli_available ? 'var(--color-accent-green)' : 'var(--color-accent-amber)'
                   }}>
                     {status.cli_available ? '✅ Available' : '⚠️ Not found'}
                   </span>
                 </div>
            
                <div className="flex items-center justify-between text-xs">
                  <span className="text-tertiary">MCP Server:</span>
                  <span className="text-secondary">
                    {status.is_embedded ? '📦 Embedded' : '🔧 Development'}
                  </span>
                </div>

                <div className="flex items-center justify-between text-xs">
                  <span className="text-tertiary">Node.js Runtime:</span>
                  <span style={{
                    color: nodeAvailable ? 'var(--color-accent-green)' : 'var(--color-accent-amber)'
                  }}>
                    {nodeAvailable ? '✅ Available' : '⚠️ Not found'}
                  </span>
                </div>
            
                <div className="flex items-center justify-between text-xs">
                  <span className="text-tertiary">Configuration:</span>
                  <span style={{
                    color: status.is_configured ? 'var(--color-accent-green)' : 'var(--color-accent-amber)'
                  }}>
                    {status.is_configured ? '✅ Configured' : '⚠️ Not configured'}
                  </span>
                </div>

                {status.is_configured && (
                  <div className="pt-2 border-t border-subtle">
                    <div className="text-xs text-muted mb-1">Server Location:</div>
                    <div className="text-xs text-secondary font-mono break-all">
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
                       className="px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed border rounded text-sm transition-colors"
                       style={{
                         backgroundColor: 'var(--color-accent-green-dark)',
                         borderColor: 'var(--color-accent-green-border)',
                         color: 'var(--color-accent-green-light)',
                       }}
                       onMouseEnter={(e) => {
                         if (!loading) {
                           e.currentTarget.style.backgroundColor = 'var(--color-accent-green)';
                         }
                       }}
                       onMouseLeave={(e) => {
                         e.currentTarget.style.backgroundColor = 'var(--color-accent-green-dark)';
                       }}
                     >
                       {requiresGlobalConfig ? 'Reconfigure MCP (global)' : 'Reconfigure MCP'}
                     </button>
                  ) : (
                    <button
                      onClick={() => { void configureMCP() }}
                       disabled={loading}
                         className="px-3 py-1 disabled:opacity-50 disabled:cursor-not-allowed rounded text-sm transition-colors"
                         style={{
                           backgroundColor: 'var(--color-accent-blue-dark)',
                           borderColor: 'var(--color-accent-blue-border)',
                           color: 'var(--color-accent-blue-light)',
                         }}
                         onMouseEnter={(e) => {
                           e.currentTarget.style.backgroundColor = 'var(--color-border-focus)';
                         }}
                         onMouseLeave={(e) => {
                           e.currentTarget.style.backgroundColor = 'var(--color-accent-blue-dark)';
                         }}
                     >
                       {agent === 'codex' || agent === 'amp' || agent === 'droid' ? 'Enable MCP (global)' : 'Configure MCP for This Project'}
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
                             backgroundColor: 'var(--color-accent-blue-dark)',
                             borderColor: 'var(--color-accent-blue-border)',
                             color: 'var(--color-accent-blue-light)',
                           }}
                           onMouseEnter={(e) => {
                             (e.target as HTMLElement).style.backgroundColor = 'var(--color-border-focus)';
                           }}
                           onMouseLeave={(e) => {
                             (e.target as HTMLElement).style.backgroundColor = 'var(--color-accent-blue-dark)';
                           }}
                        >
                         Install Claude Code First
                       </a>
                     ) : agent === 'codex' ? (
                       <div className="px-3 py-1 bg-elevated border border-subtle rounded text-sm text-secondary inline-block">
                         Install Codex CLI first
                       </div>
                     ) : agent === 'opencode' ? (
                        <a
                          href="https://opencode.ai"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="px-3 py-1 border rounded text-sm transition-colors inline-block"
                          style={{
                            backgroundColor: 'var(--color-accent-cyan-dark)',
                            borderColor: 'var(--color-accent-cyan-border)',
                            color: 'var(--color-accent-cyan-light)',
                          }}
                          onMouseEnter={(e) => {
                            (e.target as HTMLElement).style.backgroundColor = 'var(--color-accent-cyan)';
                          }}
                          onMouseLeave={(e) => {
                            (e.target as HTMLElement).style.backgroundColor = 'var(--color-accent-cyan-dark)';
                          }}
                       >
                         Install OpenCode First
                       </a>
                     ) : agent === 'amp' ? (
                       <div className="px-3 py-1 bg-elevated border border-subtle rounded text-sm text-secondary inline-block">
                         Install Amp CLI first
                       </div>
                     ) : (
                       <div className="px-3 py-1 bg-elevated border border-subtle rounded text-sm text-secondary inline-block">
                         Install Droid CLI first
                       </div>
                     )}
                  </>
                )}

                {status.is_configured && (
                  <button
                    onClick={() => { void removeMCP() }}
                    disabled={loading}
                    className="px-3 py-1 bg-elevated hover:bg-hover disabled:opacity-50 disabled:cursor-not-allowed border border-subtle rounded text-sm transition-colors text-tertiary"
                  >
                    Remove
                  </button>
                )}

                <button
                  onClick={() => setShowManualSetup(!showManualSetup)}
                  className="px-3 py-1 bg-elevated hover:bg-hover border border-subtle rounded text-sm transition-colors text-tertiary"
                >
                  {showManualSetup ? 'Hide' : 'Manual Setup'}
                </button>
              </div>

              {showManualSetup && (
                <div className="p-3 bg-secondary border border-subtle rounded">
                   <p className="text-xs text-tertiary mb-2">
                     {agent === 'codex' ? 'Add to ~/.codex/config.toml:' : agent === 'opencode' ? 'Add to opencode.json:' : agent === 'amp' ? 'Add to ~/.config/amp/settings.json:' : agent === 'droid' ? 'Add to ~/.factory/mcp.json:' : 'Run from project directory:'}
                   </p>
                  
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="p-2 bg-primary border border-default rounded overflow-x-auto">
                         <code className="text-xs text-secondary whitespace-nowrap block font-mono">
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
                      className="px-2 py-1 bg-elevated hover:bg-hover border border-subtle rounded text-xs transition-colors text-tertiary flex-shrink-0 self-start"
                      title="Copy command"
                    >
                      Copy
                    </button>
                  </div>

                   <p className="text-xs text-muted mt-2 italic">
                     {agent === 'codex'
                       ? 'This config is global. Codex will load it on next start.'
                       : agent === 'opencode'
                       ? 'This config can be project-specific (opencode.json) or global (~/.opencode/config.json).'
                       : agent === 'amp'
                       ? 'This config is global in ~/.config/amp/settings.json (Windows: %APPDATA%\\amp\\settings.json). Amp will load it on next start.'
                       : agent === 'droid'
                       ? 'This config is global in ~/.factory/mcp.json (Windows: %USERPROFILE%\\.factory\\mcp.json). Droid will load it on next start.'
                       : 'Tip: Scroll horizontally to see the full command'}
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
