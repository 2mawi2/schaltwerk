import { useEffect, useState, useImperativeHandle, forwardRef, useCallback, useRef } from 'react'
import { Terminal } from './Terminal'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { AnimatedText } from '../common/AnimatedText'
import { logger } from '../../utils/logger'
import { listenEvent, SchaltEvent, listenTerminalOutput } from '../../common/eventSystem'
import { theme } from '../../common/theme'

interface RunScript {
  command: string
  workingDirectory?: string
  environmentVariables: Record<string, string>
}

const RUN_EXIT_SENTINEL_PREFIX = '__SCHALTWERK_RUN_EXIT__='
const RUN_EXIT_SENTINEL_TERMINATORS = ['\r', '\n'] as const
const RUN_EXIT_PRINTF_COMMAND = `printf '${RUN_EXIT_SENTINEL_PREFIX}%s\r' "$__schaltwerk_exit_code"`
const RUN_EXIT_CLEAR_LINE = "printf '\\r\\033[K'"

interface RunTerminalProps {
  className?: string
  sessionName?: string
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
  onTerminalClick,
  workingDirectory,
  onRunningStateChange,
}, ref) => {
  const [runScript, setRunScript] = useState<RunScript | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [terminalCreated, setTerminalCreated] = useState(false)

  const runTerminalId = sessionName ? `run-terminal-${sessionName}` : 'run-terminal-orchestrator'
  const runStateKey = `schaltwerk:run-state:${runTerminalId}`

  const [isRunning, setIsRunning] = useState(() => sessionStorage.getItem(runStateKey) === 'true')
  const runningRef = useRef(isRunning)
  const outputBufferRef = useRef('')

  useEffect(() => {
    runningRef.current = isRunning
  }, [isRunning])

  useEffect(() => {
    sessionStorage.setItem(runStateKey, String(isRunning))
  }, [isRunning, runStateKey])

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
        logger.error('[RunTerminal] Failed to load run script:', err)
        setError('Failed to load run script configuration')
      } finally {
        setIsLoading(false)
      }
    }

    loadRunScript()
  }, [])

  useEffect(() => {
    const checkExistingTerminal = async () => {
      try {
        const exists = await invoke<boolean>(TauriCommands.TerminalExists, { id: runTerminalId })
        if (exists) {
          setTerminalCreated(true)
          const storedRunning = sessionStorage.getItem(runStateKey) === 'true'
          if (storedRunning !== isRunning) {
            runningRef.current = storedRunning
            setIsRunning(storedRunning)
            onRunningStateChange?.(storedRunning)
          }
        }
      } catch (err) {
        logger.error('[RunTerminal] Failed to check existing terminal:', err)
      }
    }
    checkExistingTerminal()
  }, [runTerminalId, runStateKey, onRunningStateChange, isRunning])

  useEffect(() => {
    let unlisten: (() => void) | null = null
    const setup = async () => {
      try {
        unlisten = await listenEvent(SchaltEvent.TerminalClosed, payload => {
          if (payload.terminal_id === runTerminalId) {
            logger.info('[RunTerminal] TerminalClosed for run terminal; marking stopped')
            runningRef.current = false
            outputBufferRef.current = ''
            setIsRunning(false)
            onRunningStateChange?.(false)
          }
        })
      } catch (err) {
        logger.error('[RunTerminal] Failed to listen for TerminalClosed:', err)
      }
    }
    setup()
    return () => { unlisten?.() }
  }, [runTerminalId, onRunningStateChange])

  useEffect(() => {
    let unlisten: (() => void) | null = null

    const setup = async () => {
      try {
        unlisten = await listenTerminalOutput(runTerminalId, (payload) => {
          if (!payload) return
          const chunk = payload.toString()
          const trimmed = chunk.trim()
          const containsSentinel = chunk.includes(RUN_EXIT_SENTINEL_PREFIX)
          const isNonInformational = trimmed.length === 0 && !containsSentinel

          // Keep a rolling buffer so we can detect sentinel across chunk boundaries.
          if (chunk.length > 0) {
            outputBufferRef.current = (outputBufferRef.current + chunk).slice(-2048)
          }

          if (isNonInformational) {
            return
          }

          let searchIndex = outputBufferRef.current.indexOf(RUN_EXIT_SENTINEL_PREFIX)
          while (searchIndex !== -1) {
            const start = searchIndex + RUN_EXIT_SENTINEL_PREFIX.length
            const terminatorIndex = RUN_EXIT_SENTINEL_TERMINATORS
              .map(term => ({ term, index: outputBufferRef.current.indexOf(term, start) }))
              .filter(({ index }) => index !== -1)
              .sort((a, b) => a.index - b.index)[0]?.index ?? -1

            if (terminatorIndex === -1) {
              // Sentinel not complete yet; keep trailing content for next chunk
              outputBufferRef.current = outputBufferRef.current.slice(searchIndex)
              return
            }

            const exitCode = outputBufferRef.current.slice(start, terminatorIndex)
            logger.info('[RunTerminal] Detected run command completion with exit code:', exitCode || 'unknown')

            if (runningRef.current) {
              runningRef.current = false
              setIsRunning(false)
              onRunningStateChange?.(false)
            }

            // Trim processed data and continue searching in case of repeated sentinels.
            outputBufferRef.current = outputBufferRef.current.slice(terminatorIndex + 1)
            searchIndex = outputBufferRef.current.indexOf(RUN_EXIT_SENTINEL_PREFIX)
          }
        })
      } catch (err) {
        logger.error('[RunTerminal] Failed to listen for run completion sentinel:', err)
      }
    }

    setup()
    return () => { unlisten?.() }
  }, [runTerminalId, onRunningStateChange])

  const executeRunCommand = useCallback(async (command: string) => {
    try {
      const decoratedCommand = [
        '__schaltwerk_exit_code=0',
        `${command}`,
        '__schaltwerk_exit_code=$?',
        RUN_EXIT_PRINTF_COMMAND,
        RUN_EXIT_CLEAR_LINE,
        'unset __schaltwerk_exit_code'
      ].join('; ') + '\n'
      outputBufferRef.current = ''
      await invoke(TauriCommands.WriteTerminal, {
        id: runTerminalId,
        data: decoratedCommand,
      })
      logger.info('[RunTerminal] Executed run script command:', command)
      runningRef.current = true
      setIsRunning(true)
      onRunningStateChange?.(true)
    } catch (err) {
      logger.error('[RunTerminal] Failed to execute run script:', err)
    }
  }, [runTerminalId, onRunningStateChange])

  const allowRunInput = useCallback((data: string) => {
    if (!data) return false
    for (let i = 0; i < data.length; i += 1) {
      const code = data.charCodeAt(i)
      if (code < 32 || code === 127) {
        return true
      }
    }
    return false
  }, [])

  useImperativeHandle(ref, () => ({
    toggleRun: async () => {
      logger.info('[RunTerminal] toggleRun called, isRunning:', isRunning, 'runScript:', runScript?.command)
      let script = runScript
      if (!script) {
        try {
        const fetched = await invoke<RunScript | null>(TauriCommands.GetProjectRunScript)
          if (fetched && fetched.command) {
            setRunScript(fetched)
            script = fetched
            setError(null)
          } else {
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
        try {
          await invoke(TauriCommands.WriteTerminal, { id: runTerminalId, data: '\u0003' })
          runningRef.current = false
          outputBufferRef.current = ''
          setIsRunning(false)
          onRunningStateChange?.(false)
        } catch (err) {
          logger.error('[RunTerminal] Failed to stop run process:', err)
        }
      } else {
        try {
          let cwd = workingDirectory || script?.workingDirectory
          if (!cwd) {
            cwd = await invoke<string>(TauriCommands.GetCurrentDirectory)
          }

          const terminalExists = await invoke<boolean>(TauriCommands.TerminalExists, { id: runTerminalId })

          if (!terminalExists) {
            logger.info('[RunTerminal] Creating new run terminal')
            setTerminalCreated(true)
            await invoke(TauriCommands.CreateRunTerminal, {
              id: runTerminalId,
              cwd,
              command: script.command,
              env: Object.entries(script.environmentVariables || {}),
              cols: null,
              rows: null,
            })
          } else {
            setTerminalCreated(true)
          }

          await executeRunCommand(script.command)
        } catch (err) {
          logger.error('[RunTerminal] Failed to start run process:', err)
        }
      }
    },
    isRunning: () => isRunning,
  }), [runScript, workingDirectory, isRunning, runTerminalId, onRunningStateChange, executeRunCommand])

  useEffect(() => { return () => {} }, [runTerminalId])

  if (isLoading) {
    return (
      <div className={`${className} flex items-center justify-center`} style={{ backgroundColor: theme.colors.background.primary }}>
        <div className="text-center">
          <AnimatedText text="loading" size="md" />
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

      <div className="flex-1 min-h-0 overflow-hidden" style={{ backgroundColor: theme.colors.background.secondary }}>
        {terminalCreated ? (
          <Terminal
            terminalId={runTerminalId}
            className="h-full w-full overflow-hidden"
            sessionName={sessionName}
            onTerminalClick={onTerminalClick}
            agentType="run"
            inputFilter={allowRunInput}
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

      {terminalCreated && !isRunning && (
        <div className="border-t border-slate-800 px-4 py-1 text-[11px] text-slate-500 flex-shrink-0" style={{ backgroundColor: theme.colors.background.elevated }}>
          [process has ended]
        </div>
      )}
    </div>
  )
})

RunTerminal.displayName = 'RunTerminal'
