/* eslint-disable no-console */
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'

type LogLevel = 'error' | 'warn' | 'info' | 'debug'

interface Logger {
  error: (message: string, ...args: unknown[]) => void
  warn: (message: string, ...args: unknown[]) => void  
  info: (message: string, ...args: unknown[]) => void
  debug: (message: string, ...args: unknown[]) => void
}

function formatArgs(message: string, ...args: unknown[]): [string, ...unknown[]] {
  if (args.length === 0) return [message]
  return [message, ...args]
}

async function logToBackend(level: LogLevel, message: string): Promise<void> {
  // Skip backend logging in test environment
  if (import.meta.env.MODE === 'test') {
    return
  }
  
  try {
    await invoke(TauriCommands.SchaltwerkCoreLogFrontendMessage, {
      level,
      message: `[Frontend] ${message}`
    })
  } catch (error) {
    console.warn(`Failed to log to backend: ${error}`)
  }
}

const isTestEnv = import.meta.env.MODE === 'test'
type TestLogMode = 'silent' | 'errors' | 'verbose'
const rawTestLogMode = (import.meta.env.VITE_TEST_LOG_MODE ?? '').toLowerCase()
const testLogMode: TestLogMode =
  rawTestLogMode === 'errors' || rawTestLogMode === 'verbose'
    ? rawTestLogMode
    : 'silent'

function shouldWriteToConsole(level: LogLevel): boolean {
  if (!import.meta.env.DEV) {
    return false
  }

  if (!isTestEnv) {
    return true
  }

  if (testLogMode === 'verbose') {
    return true
  }

  if (testLogMode === 'errors') {
    return level === 'error'
  }

  return false
}

function createLogger(): Logger {
  return {
    error: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (shouldWriteToConsole('error')) {
        console.error(...formattedArgs)
      }
      // For backend, join args into single message
      const backendMessage = formattedArgs.length > 1 
        ? formattedArgs.join(' ').replace(/\[object Object\]/g, obj => JSON.stringify(obj))
        : formattedArgs[0] as string
      logToBackend('error', backendMessage).catch(err => {
        console.warn('Failed to send error log to backend:', err)
      })
    },

    warn: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (shouldWriteToConsole('warn')) {
        console.warn(...formattedArgs)
      }
      // For backend, join args into single message
      const backendMessage = formattedArgs.length > 1 
        ? formattedArgs.join(' ').replace(/\[object Object\]/g, obj => JSON.stringify(obj))
        : formattedArgs[0] as string
      logToBackend('warn', backendMessage).catch(err => {
        console.warn('Failed to send warn log to backend:', err)
      })
    },

    info: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (shouldWriteToConsole('info')) {
        console.log(...formattedArgs)
      }
      // For backend, join args into single message
      const backendMessage = formattedArgs.length > 1 
        ? formattedArgs.join(' ').replace(/\[object Object\]/g, obj => JSON.stringify(obj))
        : formattedArgs[0] as string
      logToBackend('info', backendMessage).catch(err => {
        console.warn('Failed to send info log to backend:', err)
      })
    },

    debug: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (shouldWriteToConsole('debug')) {
        console.log(...formattedArgs)
      }
      // For backend, join args into single message
      const backendMessage = formattedArgs.length > 1 
        ? formattedArgs.join(' ').replace(/\[object Object\]/g, obj => JSON.stringify(obj))
        : formattedArgs[0] as string
      logToBackend('debug', backendMessage).catch(err => {
        console.warn('Failed to send debug log to backend:', err)
      })
    }
  }
}

export const logger = createLogger()
