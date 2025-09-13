import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { TAURI_COMMANDS } from '../../constants/commands'
import { logger } from '../../utils/logger'

interface MCPStatus {
  mcp_server_path: string
  is_embedded: boolean
  cli_available: boolean
  client: 'claude' | 'codex'
  is_configured: boolean
  setup_command: string
  project_path: string
}

interface Props {
  projectPath: string
  agent: 'claude' | 'codex'
}

export function MCPConfigPanel({ projectPath, agent }: Props) {
  const [status, setStatus] = useState<MCPStatus | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)
  const [showManualSetup, setShowManualSetup] = useState(false)
  const [mcpEnabled, setMcpEnabled] = useState(false)

  const loadStatus = useCallback(async () => {
    try {
      const mcpStatus = await invoke<MCPStatus>(TAURI_COMMANDS.MCP_GET_STATUS, { projectPath, client: agent })
      setStatus(mcpStatus)
    } catch (e) {
      setError(String(e))
    }
  }, [projectPath, agent])

  useEffect(() => {
    loadStatus()
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
      const result = await invoke<string>(TAURI_COMMANDS.MCP_CONFIGURE_PROJECT, { projectPath, client: agent })
      
      // Add .mcp.json to gitignore if needed
      try {
        await invoke<string>(TAURI_COMMANDS.MCP_ENSURE_GITIGNORED, { projectPath })
      } catch (gitignoreError) {
        logger.warn('Failed to update gitignore:', gitignoreError)
        // Don't fail the whole operation if gitignore fails
      }
      
      setSuccess(`${result}. Added .mcp.json to project and .gitignore.`)
      // Reload status
      await loadStatus()
    } catch (e) {
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
      await invoke(TAURI_COMMANDS.MCP_REMOVE_PROJECT, { projectPath, client: agent })
      setSuccess('MCP configuration removed')
      await loadStatus()
    } catch (e) {
      setError(String(e))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-slate-200">MCP Server Configuration</h3>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={mcpEnabled}
              onChange={(e) => {
                setMcpEnabled(e.target.checked)
                if (!e.target.checked && status?.is_configured) {
                  removeMCP()
                }
              }}
              className="w-4 h-4 rounded border-slate-600 bg-slate-800 text-blue-600 focus:ring-blue-500 focus:ring-offset-0"
            />
            <span className="text-xs text-slate-400">{agent === 'codex' ? 'Enable MCP (global)' : 'Enable MCP'}</span>
          </label>
        </div>
        <p className="text-xs text-slate-400">
          {agent === 'claude'
            ? 'Allow Claude Code to control Schaltwerk sessions in this project via MCP.'
            : 'Enable Codex to control Schaltwerk sessions via a global MCP entry in ~/.codex/config.toml. The server is project‑aware and routes by your current repo.'}
        </p>
      </div>

      {!mcpEnabled && (
        <div className="p-3 bg-slate-800/30 border border-slate-700 rounded text-slate-400 text-xs">
          Enable MCP configuration to allow {agent === 'claude' ? 'Claude Code' : 'Codex'} to manage sessions in this project.
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
              
              <div className="p-3 bg-blue-900/20 border border-blue-800 rounded text-blue-400 text-xs">
                <div className="flex items-start gap-2">
                  <svg className="w-4 h-4 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                  <div>
                    <div className="font-medium mb-1">Next Steps:</div>
                    <div>• Restart {agent === 'claude' ? 'Claude Code' : 'Codex'} to load the MCP server</div>
                    <div>• Or click the reset button (shown above) in the orchestrator terminal</div>
                    <div>• The MCP server will then be available for all {agent === 'claude' ? 'Claude Code' : 'Codex'} sessions in this project</div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {status && (
            <>
              <div className="space-y-2 p-3 bg-slate-800/50 rounded border border-slate-700">
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">{agent === 'claude' ? 'Claude' : 'Codex'} CLI:</span>
                  <span className={status.cli_available ? 'text-green-400' : 'text-amber-400'}>
                    {status.cli_available ? '✅ Available' : '⚠️ Not found'}
                  </span>
                </div>
            
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">MCP Server:</span>
                  <span className="text-slate-300">
                    {status.is_embedded ? '📦 Embedded' : '🔧 Development'}
                  </span>
                </div>
            
                <div className="flex items-center justify-between text-xs">
                  <span className="text-slate-400">Configuration:</span>
                  <span className={status.is_configured ? 'text-green-400' : 'text-amber-400'}>
                    {status.is_configured ? '✅ Configured' : '⚠️ Not configured'}
                  </span>
                </div>

                {status.is_configured && (
                  <div className="pt-2 border-t border-slate-700">
                    <div className="text-xs text-slate-500 mb-1">Server Location:</div>
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
                      onClick={configureMCP}
                      disabled={loading}
                      className="px-3 py-1 bg-green-800 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed border border-green-700 rounded text-sm transition-colors text-green-200"
                    >
                      {agent === 'codex' ? 'Reconfigure MCP (global)' : 'Reconfigure MCP'}
                    </button>
                  ) : (
                    <button
                      onClick={configureMCP}
                      disabled={loading}
                      className="px-3 py-1 bg-blue-800 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed border border-blue-700 rounded text-sm transition-colors text-blue-200"
                    >
                      {agent === 'codex' ? 'Enable MCP (global)' : 'Configure MCP for This Project'}
                    </button>
                  )
                ) : (
                  <>
                    {agent === 'claude' ? (
                      <a
                        href="https://claude.ai/download"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="px-3 py-1 bg-blue-800 hover:bg-blue-700 border border-blue-700 rounded text-sm transition-colors text-blue-200 inline-block"
                      >
                        Install Claude Code First
                      </a>
                    ) : (
                      <div className="px-3 py-1 bg-slate-800 border border-slate-700 rounded text-sm text-slate-300 inline-block">
                        Install Codex CLI first
                      </div>
                    )}
                  </>
                )}

                {status.is_configured && (
                  <button
                    onClick={removeMCP}
                    disabled={loading}
                    className="px-3 py-1 bg-slate-800 hover:bg-slate-700 disabled:opacity-50 disabled:cursor-not-allowed border border-slate-700 rounded text-sm transition-colors text-slate-400"
                  >
                    Remove
                  </button>
                )}
                
                <button
                  onClick={() => setShowManualSetup(!showManualSetup)}
                  className="px-3 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-sm transition-colors text-slate-400"
                >
                  {showManualSetup ? 'Hide' : 'Manual Setup'}
                </button>
              </div>

              {showManualSetup && (
                <div className="p-3 bg-slate-900 border border-slate-700 rounded">
                  <p className="text-xs text-slate-400 mb-2">
                    {agent === 'codex' ? 'Add to ~/.codex/config.toml:' : 'Run from project directory:'}
                  </p>
                  
                  <div className="flex gap-2">
                    <div className="flex-1 min-w-0">
                      <div className="p-2 bg-slate-950 border border-slate-800 rounded overflow-x-auto">
                        <code className="text-xs text-slate-300 whitespace-nowrap block font-mono">
                          {agent === 'codex' 
                            ? (<>
                                [mcp_servers.schaltwerk]
                                <br />command = "node"
                                <br />args = ["{status.mcp_server_path}"]
                              </>)
                            : (<>
                                {agent} mcp add --transport stdio --scope project schaltwerk node "{status.mcp_server_path}"
                              </>)}
                        </code>
                      </div>
                    </div>
                    
                    <button
                      onClick={copyCommand}
                      className="px-2 py-1 bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded text-xs transition-colors text-slate-400 flex-shrink-0 self-start"
                      title="Copy command"
                    >
                      Copy
                    </button>
                  </div>
                  
                  <p className="text-xs text-slate-500 mt-2 italic">
                    {agent === 'codex' 
                      ? 'This config is global. Codex will load it on next start.'
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
