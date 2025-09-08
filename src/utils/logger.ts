/* eslint-disable no-console */
import { invoke } from '@tauri-apps/api/core'

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
    await invoke('schaltwerk_core_log_frontend_message', {
      level,
      message: `[Frontend] ${message}`
    })
  } catch (error) {
    console.warn(`Failed to log to backend: ${error}`)
  }
}

function createLogger(): Logger {
  return {
    error: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (import.meta.env.DEV) {
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
      if (import.meta.env.DEV) {
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
      if (import.meta.env.DEV) {
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
      if (import.meta.env.DEV) {
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