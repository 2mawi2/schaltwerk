/* eslint-disable no-console */
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'

type LogLevel = 'error' | 'warn' | 'info' | 'debug'

const MAX_SERIALIZED_LENGTH = 8000
const TRUNCATION_SUFFIX = ' [truncated]'

type SerializeContext = {
  seen: WeakMap<object, string>
}

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

function buildBackendMessage(message: string, args: unknown[]): string {
  if (args.length === 0) {
    return message
  }

  const serialized = serializeArgs(args)
  return `${message} | data=${serialized}`
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== 'object') return false
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

function getCircularLabel(path: string): string {
  return `[Circular: ${path}]`
}

function stringifyLargePayload(payload: string): string {
  if (payload.length <= MAX_SERIALIZED_LENGTH) {
    return payload
  }
  return payload.slice(0, MAX_SERIALIZED_LENGTH) + TRUNCATION_SUFFIX
}

export function serializeArg(
  value: unknown,
  context: SerializeContext = { seen: new WeakMap<object, string>() },
  path = 'arg'
): unknown {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return `${value}n`
  }

  if (typeof value === 'undefined') {
    return '[undefined]'
  }

  if (typeof value === 'function') {
    return `[Function ${value.name || 'anonymous'}]`
  }

  if (typeof value === 'symbol') {
    return `[Symbol ${value.description ?? ''}]`
  }

  if (value && typeof value === 'object') {
    const seenPath = context.seen.get(value as object)
    if (seenPath) {
      return getCircularLabel(seenPath)
    }
    context.seen.set(value as object, path)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Error) {
    const errorRecord = value as unknown as Record<string, unknown>
    const serializedError: Record<string, unknown> = {
      type: 'Error',
      name: value.name,
      message: value.message
    }

    if (value.stack) {
      serializedError.stack = value.stack
    }

    for (const key of Object.keys(value)) {
      serializedError[key] = serializeArg(errorRecord[key], context, `${path}.${key}`)
    }

    return serializedError
  }

  if (Array.isArray(value)) {
    return value.map((item, index) => serializeArg(item, context, `${path}[${index}]`))
  }

  if (value instanceof Map) {
    const entries: unknown[] = []
    let index = 0
    for (const [key, mapValue] of value.entries()) {
      entries.push([
        serializeArg(key, context, `${path}.key${index}`),
        serializeArg(mapValue, context, `${path}.value${index}`)
      ])
      index += 1
    }
    return {
      type: 'Map',
      entries
    }
  }

  if (value instanceof Set) {
    const values: unknown[] = []
    let index = 0
    for (const item of value.values()) {
      values.push(serializeArg(item, context, `${path}[${index}]`))
      index += 1
    }
    return {
      type: 'Set',
      values
    }
  }

  if (isPlainObject(value)) {
    const serializedObject: Record<string, unknown> = {}
    const keys = Object.keys(value).sort()

    for (const key of keys) {
      serializedObject[key] = serializeArg(
        (value as Record<string, unknown>)[key],
        context,
        `${path}.${key}`
      )
    }

    return serializedObject
  }

  if (value && typeof value === 'object') {
    return String(value)
  }

  return '[unknown]'
}

export function serializeArgs(args: unknown[]): string {
  try {
    const serialized = args.map((arg, index) => serializeArg(arg, { seen: new WeakMap() }, `arg${index}`))
    const json = JSON.stringify(serialized)
    if (!json) {
      return '[Unserializable log payload]'
    }
    return stringifyLargePayload(json)
  } catch (_error) {
    return '[Unserializable log payload]'
  }
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
      const backendMessage = buildBackendMessage(message, args)
      logToBackend('error', backendMessage).catch(err => {
        console.warn('Failed to send error log to backend:', err)
      })
    },

    warn: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (shouldWriteToConsole('warn')) {
        console.warn(...formattedArgs)
      }
      const backendMessage = buildBackendMessage(message, args)
      logToBackend('warn', backendMessage).catch(err => {
        console.warn('Failed to send warn log to backend:', err)
      })
    },

    info: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (shouldWriteToConsole('info')) {
        console.log(...formattedArgs)
      }
      const backendMessage = buildBackendMessage(message, args)
      logToBackend('info', backendMessage).catch(err => {
        console.warn('Failed to send info log to backend:', err)
      })
    },

    debug: (message: string, ...args: unknown[]) => {
      const formattedArgs = formatArgs(message, ...args)
      if (shouldWriteToConsole('debug')) {
        console.log(...formattedArgs)
      }
      const backendMessage = buildBackendMessage(message, args)
      logToBackend('debug', backendMessage).catch(err => {
        console.warn('Failed to send debug log to backend:', err)
      })
    }
  }
}

export const logger = createLogger()
