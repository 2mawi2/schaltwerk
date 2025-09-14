import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react'
import { TauriCommands } from '../../common/tauriCommands'
import { Terminal } from './Terminal'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { theme } from '../../common/theme'

interface RunScript {
    command: string
    workingDirectory?: string
    environmentVariables: Record<string, string>
}

interface RunTerminalProps {
    className?: string
    sessionName?: string
    isCommander?: boolean
    onTerminalClick?: () => void
    workingDirectory?: string
    onRunningStateChange?: (isRunning: boolean) => void
}

export interface RunTerminalHandle {
    toggleRun: () => void
    isRunning: () => boolean
}

export const RunTerminal = forwardRef<RunTerminalHandle, RunTerminalProps>(({ 
    className, 
    sessionName, 
    isCommander = false, 
    onTerminalClick,
    workingDirectory,
    onRunningStateChange
}, ref) => {
    const [runScript, setRunScript] = useState<RunScript | null>(null)
    const [isLoading, setIsLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)
    const [terminalCreated, setTerminalCreated] = useState(false) // Changed to state to trigger re-renders
    const terminalReadyRef = useRef(false)
    
    // Create unique terminal ID for this session
    const runTerminalId = sessionName ? `run-terminal-${sessionName}` : 'run-terminal-orchestrator'
    const runStateKey = `schaltwerk:run-state:${runTerminalId}`
    
    // Initialize running state from sessionStorage
    const [isRunning, setIsRunning] = useState(() => {
        const stored = sessionStorage.getItem(runStateKey)
        return stored === 'true'
    })
    
    // Persist running state changes
    useEffect(() => {
        sessionStorage.setItem(runStateKey, String(isRunning))
    }, [isRunning, runStateKey])

    // Load run script configuration
    useEffect(() => {
        const loadRunScript = async () => {
            try {
                setIsLoading(true)
                const script = await invoke<RunScript | null>(TauriCommands.GetProjectRunScript)
                if (script && script.command) {
                    setRunScript(script)
                    setError(null)
                } else {
                    setError('No run script configured')
                }
            } catch (err) {
                logger.error('Failed to load run script:', err)
                setError('Failed to load run script configuration')
            } finally {
                setIsLoading(false)
            }
        }

        loadRunScript()
    }, [])
    
    // Check if terminal already exists on mount and restore state
    useEffect(() => {
        const checkExistingTerminal = async () => {
            try {
                const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: runTerminalId })
                if (exists) {
                    logger.info(`Found existing run terminal: ${runTerminalId}`)
                    setTerminalCreated(true)
                    // Restore running state from storage
                    const storedRunning = sessionStorage.getItem(runStateKey) === 'true'
                    if (storedRunning !== isRunning) {
                        setIsRunning(storedRunning)
                        onRunningStateChange?.(storedRunning)
                    }
                }
            } catch (err) {
                logger.error('Failed to check existing terminal:', err)
            }
        }
        checkExistingTerminal()
    }, [runTerminalId, runStateKey, onRunningStateChange, isRunning])
    
    // Listen to TerminalClosed event to detect process end deterministically
    useEffect(() => {
        let unlisten: (() => void) | null = null
        const setup = async () => {
            try {
                unlisten = await listenEvent(SchaltEvent.TerminalClosed, (payload: { terminal_id: string }) => {
                    if (payload.terminal_id === runTerminalId) {
                        logger.info('[RunTerminal] TerminalClosed received for run terminal; marking stopped')
                        setIsRunning(false)
                        onRunningStateChange?.(false)
                    }
                })
            } catch (err) {
                logger.error('[RunTerminal] Failed to listen for TerminalClosed:', err)
            }
        }
        setup()
        return () => { if (unlisten) unlisten() }
    }, [runTerminalId, onRunningStateChange])

    // Listen for terminal-ready events to know when hydration is complete
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ terminalId: string }>).detail
            if (!detail) return
            if (detail.terminalId === runTerminalId) {
                terminalReadyRef.current = true
            }
        }
        window.addEventListener('schaltwerk:terminal-ready', handler as EventListener)
        return () => window.removeEventListener('schaltwerk:terminal-ready', handler as EventListener)
    }, [runTerminalId])

    
    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        toggleRun: async () => {
            logger.info('[RunTerminal] toggleRun called, isRunning:', isRunning, 'runScript:', runScript?.command)
            let script = runScript
            if (!script) {
                // Lazy-load run script to support immediate toggles after mount
                try {
                    const fetched = await invoke<RunScript | null>(TauriCommands.GetProjectRunScript)
                    if (fetched && fetched.command) {
                        setRunScript(fetched)
                        script = fetched
                        setError(null)
                    } else {
                        logger.warn('[RunTerminal] No run script available on demand')
                        setError('No run script configured')
                        return
                    }
                } catch (err) {
                    logger.error('[RunTerminal] Failed to fetch run script on demand:', err)
                    setError('Failed to load run script configuration')
                    return
                }
            }
            
            if (isRunning) {
                // Stop the run - send Ctrl+C but keep terminal alive
                logger.info('[RunTerminal] Stopping run process')
                try {
                    const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: runTerminalId })
                    if (exists) {
                        // Send Ctrl+C to stop the process
                        await invoke(TauriCommands.WriteTerminal, {
                            id: runTerminalId,
                            data: '\x03' // Ctrl+C
                        })
                        logger.info('[RunTerminal] Sent Ctrl+C to stop process')
                    }
                    setIsRunning(false)
                    onRunningStateChange?.(false)
                } catch (err) {
                    logger.error('[RunTerminal] Failed to stop run process:', err)
                }
            } else {
                // Start the run process
                logger.info('[RunTerminal] Starting run process')
                try {
                    let cwd = workingDirectory || script?.workingDirectory
                    if (!cwd) {
                        cwd = await invoke<string>(TauriCommands.GetCurrentDirectory)
                    }

                    // Check if terminal already exists (from previous run)
                    const terminalExists = await invoke<boolean>(TauriCommands.TerminalExists, { id: runTerminalId })
                    
                    if (terminalExists) {
                        // Terminal exists (from previous run) - write command to existing terminal
                        // This preserves previous output while running new command
                        logger.info('[RunTerminal] Using existing terminal, writing command to preserve previous output')
                        await invoke(TauriCommands.WriteTerminal, {
                            id: runTerminalId,
                            data: script.command + '\n'
                        })
                    } else {
                        // No existing terminal - create new one
                        logger.info('[RunTerminal] Creating new run terminal')
                        setTerminalCreated(true)
                        terminalReadyRef.current = false
                        await invoke(TauriCommands.CreateRunTerminal, {
                            id: runTerminalId,
                            cwd,
                            command: script.command,
                            env: Object.entries(script.environmentVariables || {}),
                            cols: null,
                            rows: null,
                        })
                        
                        // Send the command to the newly created interactive shell
                        await invoke(TauriCommands.WriteTerminal, {
                            id: runTerminalId,
                            data: script.command + '\n'
                        })
                    }
                    
                    // Ensure terminal pane is visible
                    setTerminalCreated(true)
                    setIsRunning(true)
                    onRunningStateChange?.(true)
                } catch (err) {
                    logger.error('[RunTerminal] Failed to start run process:', err)
                }
            }
        },
        isRunning: () => isRunning
    }), [runScript, workingDirectory, isRunning, runTerminalId, onRunningStateChange])

    // Cleanup: DO NOT kill the terminal - let it persist for when we come back
    useEffect(() => { return () => {} }, [runTerminalId])

    if (isLoading) {
        return (
            <div className={`${className} flex items-center justify-center`} style={{ backgroundColor: theme.colors.background.primary }}>
                <div className="text-center">
                    <AnimatedText text="loading" size="md" colorClassName="text-slate-500" />
                    <div className="text-xs text-slate-600 mt-2">Loading run script...</div>
                </div>
            </div>
        )
    }

    if (error || !runScript) {
        return (
            <div className={`${className} flex items-center justify-center`} style={{ backgroundColor: theme.colors.background.primary }}>
                <div className="text-center p-8 max-w-md">
                    <div className="text-slate-600 text-5xl mb-4">⚡</div>
                    <div className="text-slate-400 font-medium text-lg mb-2">No Run Script Configured</div>
                    <div className="text-sm text-slate-500 mb-4">
                        {error || 'Configure a run script to execute commands in this project'}
                    </div>
                    <div className="text-xs text-slate-600">
                        Go to Settings → Run Scripts to set up your run command
                    </div>
                </div>
            </div>
        )
    }

    return (
        <div className={`${className} flex flex-col overflow-hidden`} style={{ backgroundColor: theme.colors.background.primary }}>
            {/* Run script info header */}
            <div className="bg-slate-900 border-b border-slate-800 px-4 py-2 flex-shrink-0">
                <div className="flex items-center gap-3 text-xs">
                    <span className={`${isRunning ? 'text-green-500 animate-pulse' : 'text-slate-600'}`}>
                        {isRunning ? '▶' : '■'}
                    </span>
                    <span className="text-slate-500">{isRunning ? 'Running:' : 'Ready to run:'}</span>
                    <code className={`bg-slate-800 px-2 py-0.5 rounded font-mono ${isRunning ? 'text-green-400' : 'text-slate-400'}`}>
                        {runScript.command}
                    </code>
                </div>
            </div>
            
            {/* Terminal or placeholder */}
            <div className="flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: theme.colors.background.secondary }}>
                {terminalCreated ? (
                    <Terminal
                        terminalId={runTerminalId}
                        className="h-full w-full overflow-hidden"
                        sessionName={sessionName}
                        isCommander={isCommander}
                        agentType="run"
                        readOnly={true}
                        onTerminalClick={onTerminalClick}
                        onReady={() => {
                            terminalReadyRef.current = true
                        }}
                    />
                ) : (
                    <div className="h-full flex items-center justify-center" style={{ backgroundColor: theme.colors.background.secondary }}>
                        <div className="text-center">
                            <div className="text-slate-600 text-4xl mb-4">▶</div>
                            <div className="text-slate-500 text-sm">Press ⌘E or click Run to start</div>
                        </div>
                    </div>
                )}
            </div>
            {/* Footer status like VSCode when process ended */}
            {terminalCreated && !isRunning && (
                <div className="border-t border-slate-800 px-4 py-1 text-[11px] text-slate-500 flex-shrink-0" style={{ backgroundColor: theme.colors.background.elevated }}>
                    [process has ended]
                </div>
            )}
        </div>
    )
})

RunTerminal.displayName = 'RunTerminal'
