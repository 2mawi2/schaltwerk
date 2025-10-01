import { invoke } from '@tauri-apps/api/core'
import { UnlistenFn } from '@tauri-apps/api/event'
import { listenEvent, SchaltEvent } from '../../common/eventSystem'
import { TauriCommands } from '../../common/tauriCommands'
import type { TerminalTransport } from './TerminalTransport'
import { logger } from '../../utils/logger'

interface SubscribeSnapshot {
  term_id: string
  seq: number
  base64: string
}

interface SubscribeDelta {
  term_id: string
  seq: number
}

type SubscribeResponse =
  | { Snapshot: SubscribeSnapshot }
  | { DeltaReady: SubscribeDelta }

function decodeBase64(base64: string): Uint8Array {
  if (!base64) return new Uint8Array()
  const binary = atob(base64)
  const array = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) {
    array[i] = binary.charCodeAt(i)
  }
  return array
}

function mapEnv(env?: Array<{ key: string; value: string }>): Array<[string, string]> {
  if (!env) return []
  return env.map(({ key, value }) => [key, value])
}

export class PluginTransport implements TerminalTransport {
  private highestSeq = new Map<string, number>()

  private listeners = new Map<string, Promise<UnlistenFn>>()

  async spawn(opts: { id: string; cwd: string; rows: number; cols: number; env?: Array<{ key: string; value: string }> }): Promise<{ termId: string }> {
    const response = await invoke<{ term_id: string }>(TauriCommands.PtySpawn, {
      options: {
        id: opts.id,
        cwd: opts.cwd,
        rows: opts.rows,
        cols: opts.cols,
        env: mapEnv(opts.env),
      },
    })
    return { termId: response.term_id }
  }

  async write(termId: string, data: string): Promise<void> {
    await invoke(TauriCommands.PtyWrite, { term_id: termId, utf8: data })
  }

  async resize(termId: string, rows: number, cols: number): Promise<void> {
    await invoke(TauriCommands.PtyResize, { term_id: termId, rows, cols })
  }

  async kill(termId: string): Promise<void> {
    if (this.listeners.has(termId)) {
      try {
        const unlisten = await this.listeners.get(termId)!
        unlisten()
      } catch (error) {
        logger.warn('[PluginTransport] failed to unlisten on kill', error)
      }
      this.listeners.delete(termId)
    }
    this.highestSeq.delete(termId)
    await invoke(TauriCommands.PtyKill, { term_id: termId })
  }

  async subscribe(
    termId: string,
    lastSeenSeq: number,
    onData: (message: { seq: number; bytes: Uint8Array }) => void,
  ): Promise<() => Promise<void>> {
    await this.unsubscribe(termId)

    const response = await invoke<SubscribeResponse>(TauriCommands.PtySubscribe, {
      params: { term_id: termId, last_seen_seq: lastSeenSeq ?? null },
    })

    if ('Snapshot' in response) {
      const snapshot = response.Snapshot
      const bytes = decodeBase64(snapshot.base64)
      this.highestSeq.set(termId, snapshot.seq)
      if (bytes.length > 0) {
        onData({ seq: snapshot.seq, bytes })
      }
    } else if ('DeltaReady' in response) {
      this.highestSeq.set(termId, response.DeltaReady.seq)
    }

    const listenerPromise = listenEvent(SchaltEvent.PtyData, payload => {
      if (!payload || payload.term_id !== termId) return
      const prevSeq = this.highestSeq.get(termId) ?? 0
      if (payload.seq <= prevSeq) {
        return
      }

      const bytes = decodeBase64(payload.base64)
      this.highestSeq.set(termId, payload.seq)
      if (bytes.length > 0) {
        onData({ seq: payload.seq, bytes })
      }
    })

    this.listeners.set(termId, listenerPromise)

    return async () => {
      const unlisten = await listenerPromise.catch(error => {
        logger.warn('[PluginTransport] failed to resolve listener promise', error)
        return undefined
      })
      if (unlisten) {
        unlisten()
      }
      this.listeners.delete(termId)
    }
  }

  async ack(termId: string, seq: number, bytes: number): Promise<void> {
    await invoke(TauriCommands.PtyAck, { term_id: termId, seq, bytes })
  }

  private async unsubscribe(termId: string) {
    if (!this.listeners.has(termId)) return
    try {
      const unlisten = await this.listeners.get(termId)!
      unlisten()
    } catch (error) {
      logger.warn('[PluginTransport] failed to unlisten existing subscription', error)
    }
    this.listeners.delete(termId)
  }
}
