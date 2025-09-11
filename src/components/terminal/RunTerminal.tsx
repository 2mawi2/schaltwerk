import { useEffect, useState, useRef, useImperativeHandle, forwardRef, useCallback } from 'react'
import { Terminal } from './Terminal'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { listenTerminalOutput } from '../../common/eventSystem'
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
    const processMonitorIntervalRef = useRef<NodeJS.Timeout | null>(null)
    const terminalReadyRef = useRef(false)
    const awaitingStartRef = useRef(false)
    
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
                const script = await invoke<RunScript | null>('get_project_run_script')
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
                const exists = await invoke<boolean>('terminal_exists', { id: runTerminalId })
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
    
    // Monitor process exit by watching terminal output
    useEffect(() => {
        if (!isRunning || !terminalCreated) return
        
        // Start monitoring for process exit patterns
        const checkProcessStatus = async () => {
            try {
                // Listen for terminal output to detect process exit
                const unlisten = await listenTerminalOutput(runTerminalId, (output) => {
                    // Check for more specific exit patterns that indicate the main process has exited
                    const exitPatterns = [
                        /Process finished with exit code/i,
                        /\[Exit code: \d+\]/,
                        /^\[Process exited with code \d+\]/,
                        /^Process terminated/i,
                        /^Killed: 9$/,
                        /^npm ERR! Lifecycle script.*failed/
                    ]
                    
                    const hasExitPattern = exitPatterns.some(pattern => pattern.test(output))
                    if (hasExitPattern) {
                        logger.info('Process exit pattern detected, stopping run terminal')
                        handleProcessExit()
                    }
                })
                
                // Store unlisten function to clean up later
                return unlisten
            } catch (err) {
                logger.error('Failed to monitor terminal output:', err)
            }
        }
        
        const handleProcessExit = async () => {
            // Process has exited, reset state
            logger.info('Process exited, updating run state')
            setIsRunning(false)
            onRunningStateChange?.(false)
            // Keep the terminal open to show the result - user can see what happened
        }
        
        // Also periodically check if terminal still exists (fallback detection)
        processMonitorIntervalRef.current = setInterval(async () => {
            try {
                const exists = await invoke<boolean>('terminal_exists', { id: runTerminalId })
                if (!exists && terminalCreated) {
                    logger.info('Terminal no longer exists, resetting state')
                    handleProcessExit()
                    if (processMonitorIntervalRef.current) {
                        clearInterval(processMonitorIntervalRef.current)
                        processMonitorIntervalRef.current = null
                    }
                }
            } catch (err) {
                // Terminal check failed, might be gone
                logger.warn('Terminal existence check failed:', err)
            }
        }, 1000)
        
        // Set up output listener
        let unlistenPromise = checkProcessStatus()
        
        return () => {
            // Clean up interval
            if (processMonitorIntervalRef.current) {
                clearInterval(processMonitorIntervalRef.current)
                processMonitorIntervalRef.current = null
            }
            // Clean up listener
            unlistenPromise?.then(unlisten => unlisten?.())
        }
    }, [isRunning, onRunningStateChange, runTerminalId, terminalCreated])

    // Listen for terminal-ready events to know when hydration is complete
    useEffect(() => {
        const handler = (e: Event) => {
            const detail = (e as CustomEvent<{ terminalId: string }>).detail
            if (!detail) return
            if (detail.terminalId === runTerminalId) {
                terminalReadyRef.current = true
                // If a run is pending, execute it now
                if (awaitingStartRef.current) {
                    executeRunCommand()
                }
            }
        }
        window.addEventListener('schaltwerk:terminal-ready' as any, handler as any)
        return () => window.removeEventListener('schaltwerk:terminal-ready' as any, handler as any)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [runTerminalId])

    // Encapsulate command execution to ensure single-shot behavior
    const executeRunCommand = useCallback(async () => {
        awaitingStartRef.current = false
        try {
            await invoke('write_terminal', {
                id: runTerminalId,
                data: (runScript?.command ?? '') + '\n'
            })
            logger.info('Executed run script command:', runScript?.command)
            setIsRunning(true)
            onRunningStateChange?.(true)
        } catch (err) {
            logger.error('Failed to execute run script:', err)
        }
    }, [runTerminalId, runScript, setIsRunning, onRunningStateChange])
    
    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        toggleRun: async () => {
            logger.info('[RunTerminal] toggleRun called, isRunning:', isRunning, 'runScript:', runScript?.command)
            if (!runScript) {
                logger.warn('[RunTerminal] No run script available')
                return
            }
            
            if (isRunning) {
                // Stop the run - send Ctrl+C but keep terminal alive
                logger.info('[RunTerminal] Stopping run process')
                try {
                    const exists = await invoke<boolean>('terminal_exists', { id: runTerminalId })
                    if (exists) {
                        // Send Ctrl+C to stop the process
                        await invoke('write_terminal', {
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
                // Start the run - reuse existing terminal if possible
                logger.info('[RunTerminal] Starting run process')
                try {
                    const exists = await invoke<boolean>('terminal_exists', { id: runTerminalId })
                    logger.info('[RunTerminal] Terminal exists:', exists, 'terminalId:', runTerminalId)
                    
                    if (!exists) {
                        // Create terminal only if it doesn't exist
                        let cwd = workingDirectory || runScript?.workingDirectory
                        if (!cwd) {
                            cwd = await invoke<string>('get_current_directory')
                        }
                        
                        logger.info('[RunTerminal] Creating new terminal with cwd:', cwd)
                        await invoke('create_terminal', {
                            id: runTerminalId,
                            cwd: cwd
                        })
                        logger.info('[RunTerminal] Terminal created successfully')
                        setTerminalCreated(true) // This will trigger re-render to show Terminal component
                        terminalReadyRef.current = false
                    } else {
                        logger.info('[RunTerminal] Reusing existing terminal')
                        setTerminalCreated(true)
                        // If terminal has already hydrated previously, we may already be ready
                        // The onReady callback below will also set this flag on re-hydration
                    }

                    // Schedule command execution when terminal is confirmed ready
                    awaitingStartRef.current = true
                    logger.info('[RunTerminal] Awaiting terminal ready, current ready state:', terminalReadyRef.current)
                    
                    if (terminalReadyRef.current) {
                        // If already ready, execute immediately
                        logger.info('[RunTerminal] Terminal already ready, executing command immediately')
                        executeRunCommand()
                    } else {
                        logger.info('[RunTerminal] Terminal not ready yet, waiting for ready event')
                        // The terminal-ready event listener will handle execution when ready
                        // No timeout needed - the event system is reliable
                    }
                } catch (err) {
                    logger.error('[RunTerminal] Failed to start run terminal:', err)
                }
            }
        },
        isRunning: () => isRunning
    }), [runScript, workingDirectory, isRunning, runTerminalId, onRunningStateChange, executeRunCommand])

    // Cleanup: only clean up monitoring, NOT the terminal itself
    // Note: We intentionally don't close terminals here to allow switching between sessions
    // All terminals are cleaned up when the app exits via the backend cleanup handler
    useEffect(() => {
        return () => {
            // Clean up monitoring interval only
            if (processMonitorIntervalRef.current) {
                clearInterval(processMonitorIntervalRef.current)
                processMonitorIntervalRef.current = null
            }
            // DO NOT kill the terminal - let it persist for when we come back
        }
    }, [runTerminalId])

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
                        onTerminalClick={onTerminalClick}
                        onReady={() => {
                            terminalReadyRef.current = true
                            if (awaitingStartRef.current) {
                                executeRunCommand()
                            }
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
        </div>
    )
})

RunTerminal.displayName = 'RunTerminal'
