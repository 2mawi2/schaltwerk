import { useEffect, useState, useRef, useImperativeHandle, forwardRef } from 'react'
import { Terminal } from './Terminal'
import { invoke } from '@tauri-apps/api/core'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { listenTerminalOutput } from '../../common/eventSystem'

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
    const terminalCreatedRef = useRef(false)
    const processMonitorIntervalRef = useRef<NodeJS.Timeout | null>(null)
    
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
                    terminalCreatedRef.current = true
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
    }, [runTerminalId, runStateKey, onRunningStateChange])
    
    // Monitor process exit by watching terminal output
    useEffect(() => {
        if (!isRunning || !terminalCreatedRef.current) return
        
        // Start monitoring for process exit patterns
        const checkProcessStatus = async () => {
            try {
                // Listen for terminal output to detect process exit
                const unlisten = await listenTerminalOutput(runTerminalId, (output) => {
                    // Check for common exit patterns
                    const exitPatterns = [
                        /Process finished with exit code/i,
                        /npm ERR!/,
                        /Error:/,
                        /\[Exit code: \d+\]/,
                        /Terminated/i,
                        /Killed/i,
                        /^\s*$/  // Empty output after previously having output might indicate exit
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
                if (!exists && terminalCreatedRef.current) {
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
    }, [isRunning, onRunningStateChange, runTerminalId])
    
    // Expose methods via ref
    useImperativeHandle(ref, () => ({
        toggleRun: async () => {
            if (!runScript) return
            
            if (isRunning) {
                // Stop the run - send Ctrl+C but keep terminal alive
                try {
                    const exists = await invoke<boolean>('terminal_exists', { id: runTerminalId })
                    if (exists) {
                        // Send Ctrl+C to stop the process
                        await invoke('write_terminal', {
                            id: runTerminalId,
                            data: '\x03' // Ctrl+C
                        })
                        logger.info('Stopped run process (terminal kept alive)')
                    }
                    setIsRunning(false)
                    onRunningStateChange?.(false)
                } catch (err) {
                    logger.error('Failed to stop run process:', err)
                }
            } else {
                // Start the run - reuse existing terminal if possible
                try {
                    const exists = await invoke<boolean>('terminal_exists', { id: runTerminalId })
                    
                    if (!exists) {
                        // Create terminal only if it doesn't exist
                        let cwd = workingDirectory || runScript?.workingDirectory
                        if (!cwd) {
                            cwd = await invoke<string>('get_current_directory')
                        }
                        
                        await invoke('create_terminal', {
                            id: runTerminalId,
                            cwd: cwd
                        })
                        logger.info(`Created new run terminal with cwd: ${cwd}`)
                        terminalCreatedRef.current = true
                    } else {
                        logger.info(`Reusing existing run terminal: ${runTerminalId}`)
                        terminalCreatedRef.current = true
                    }
                    
                    // Execute the command after a small delay
                    setTimeout(async () => {
                        try {
                            await invoke('write_terminal', {
                                id: runTerminalId,
                                data: runScript.command + '\n'
                            })
                            logger.info('Executed run script command:', runScript.command)
                            setIsRunning(true)
                            onRunningStateChange?.(true)
                        } catch (err) {
                            logger.error('Failed to execute run script:', err)
                        }
                    }, 500)
                } catch (err) {
                    logger.error('Failed to start run terminal:', err)
                }
            }
        },
        isRunning: () => isRunning
    }), [runScript, workingDirectory, isRunning, runTerminalId, onRunningStateChange])

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
            <div className={`${className} flex items-center justify-center bg-slate-950`}>
                <div className="text-center">
                    <AnimatedText text="loading" size="md" colorClassName="text-slate-500" />
                    <div className="text-xs text-slate-600 mt-2">Loading run script...</div>
                </div>
            </div>
        )
    }

    if (error || !runScript) {
        return (
            <div className={`${className} flex items-center justify-center bg-slate-950`}>
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
        <div className={`${className} flex flex-col bg-slate-950 overflow-hidden`}>
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
            <div className="flex-1 min-h-0 bg-black overflow-hidden">
                {terminalCreatedRef.current ? (
                    <Terminal
                        terminalId={runTerminalId}
                        className="h-full w-full overflow-hidden"
                        sessionName={sessionName}
                        isCommander={isCommander}
                        agentType="run"
                        onTerminalClick={onTerminalClick}
                    />
                ) : (
                    <div className="h-full flex items-center justify-center">
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