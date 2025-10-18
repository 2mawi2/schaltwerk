import { invoke } from '@tauri-apps/api/core'
import type { UnlistenFn } from '@tauri-apps/api/event'

import { listenTerminalOutput } from '../../common/eventSystem'
import { TauriCommands } from '../../common/tauriCommands'
import { ackTerminalBackend, isPluginTerminal, subscribeTerminalBackend } from '../transport/backend'
import { logger } from '../../utils/logger'

type TerminalStreamListener = (chunk: string) => void

interface TerminalBufferResponse {
  seq: number
  startSeq: number
  data: string
}

interface PluginMessage {
  seq: number
  bytes: Uint8Array
}

interface TerminalStream {
  started: boolean
  starting?: Promise<void>
  seqCursor: number | null
  unlisten?: UnlistenFn
  pluginUnlisten?: (() => void) | Promise<void> | null
  listeners: Set<TerminalStreamListener>
  decoder?: TextDecoder
}

function createStream(): TerminalStream {
  return {
    started: false,
    seqCursor: null,
    listeners: new Set(),
  }
}

class TerminalOutputManager {
  private streams = new Map<string, TerminalStream>()

  addListener(id: string, listener: TerminalStreamListener): void {
    const stream = this.ensureStream(id)
    stream.listeners.add(listener)
  }

  removeListener(id: string, listener: TerminalStreamListener): void {
    const stream = this.streams.get(id)
    if (!stream) return
    stream.listeners.delete(listener)
  }

  async ensureStarted(id: string): Promise<void> {
    const stream = this.ensureStream(id)
    if (stream.started) return
    if (stream.starting) {
      await stream.starting
      return
    }
    const startPromise = this.startStream(id, stream)
    stream.starting = startPromise
    try {
      await startPromise
    } finally {
      stream.starting = undefined
    }
  }

  async dispose(id: string): Promise<void> {
    const stream = this.streams.get(id)
    if (!stream) return
    if (stream.unlisten) {
      try {
        stream.unlisten()
      } catch (error) {
        logger.debug(`[TerminalOutput] standard unlisten failed for ${id}`, error)
      }
    }
    const pluginUnlisten = stream.pluginUnlisten
    if (pluginUnlisten) {
      try {
        const result = typeof pluginUnlisten === 'function' ? pluginUnlisten() : pluginUnlisten
        if (result instanceof Promise) {
          await result.catch(err => logger.debug(`[TerminalOutput] plugin unlisten failed for ${id}`, err))
        }
      } catch (error) {
        logger.debug(`[TerminalOutput] plugin unlisten execution failed for ${id}`, error)
      }
    }
    stream.listeners.clear()
    this.streams.delete(id)
  }

  private ensureStream(id: string): TerminalStream {
    let stream = this.streams.get(id)
    if (!stream) {
      stream = createStream()
      this.streams.set(id, stream)
    }
    return stream
  }

  private async startStream(id: string, stream: TerminalStream): Promise<void> {
    try {
      stream.seqCursor = await this.hydrate(id, stream)
      if (isPluginTerminal(id)) {
        await this.startPluginStream(id, stream)
      } else {
        await this.startStandardStream(id, stream)
      }
      stream.started = true
    } catch (error) {
      stream.started = false
      logger.error(`[TerminalOutput] failed to start stream for ${id}`, error)
      throw error
    }
  }

  private async hydrate(id: string, stream: TerminalStream): Promise<number | null> {
    try {
      const snapshot = await invoke<TerminalBufferResponse | null>(TauriCommands.GetTerminalBuffer, {
        id,
        from_seq: stream.seqCursor ?? null,
      })
      if (!snapshot || typeof snapshot.seq !== 'number') {
        return stream.seqCursor
      }
      if (snapshot.data && snapshot.data.length > 0) {
        this.dispatch(id, snapshot.data)
      }
      return snapshot.seq
    } catch (error) {
      logger.debug(`[TerminalOutput] hydration failed for ${id}`, error)
      return stream.seqCursor
    }
  }

  private async startStandardStream(id: string, stream: TerminalStream): Promise<void> {
    try {
      stream.unlisten = await listenTerminalOutput(id, chunk => {
        if (typeof chunk !== 'string' || chunk.length === 0) {
          return
        }
        this.dispatch(id, chunk)
      })
    } catch (error) {
      logger.debug(`[TerminalOutput] standard listener failed for ${id}`, error)
      throw error
    }
  }

  private async startPluginStream(id: string, stream: TerminalStream): Promise<void> {
    const decoder = stream.decoder ?? new TextDecoder('utf-8', { fatal: false })
    stream.decoder = decoder
    stream.pluginUnlisten = await subscribeTerminalBackend(id, stream.seqCursor ?? 0, (message: PluginMessage) => {
      stream.seqCursor = message.seq
      if (message.bytes.length === 0) {
        return
      }
      try {
        const text = decoder.decode(message.bytes, { stream: true })
        if (text && text.length > 0) {
          this.dispatch(id, text)
        }
      } catch (error) {
        logger.debug(`[TerminalOutput] decode failed for ${id}`, error)
      }
      ackTerminalBackend(id, message.seq, message.bytes.length).catch(err => {
        logger.debug(`[TerminalOutput] ack failed for ${id}`, err)
      })
    })
  }

  private dispatch(id: string, chunk: string): void {
    const stream = this.streams.get(id)
    if (!stream) return
    for (const listener of stream.listeners) {
      try {
        listener(chunk)
      } catch (error) {
        logger.debug(`[TerminalOutput] listener error for ${id}`, error)
      }
    }
  }
}

export const terminalOutputManager = new TerminalOutputManager()
