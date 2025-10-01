import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../common/tauriCommands'
import { PluginTransport } from './PluginTransport'
import { shouldUsePluginTransport, getPluginTransport } from './transportFlags'
import { logger } from '../../utils/logger'

export type SpawnRequest = {
  id: string
  cwd: string
  cols?: number
  rows?: number
  env?: Array<{ key: string; value: string }>
}

const pluginTerminals = new Set<string>()

function mapEnv(env?: Array<{ key: string; value: string }>): Array<{ key: string; value: string }> {
  if (!env) return []
  return env
}

export function isPluginTerminal(id: string): boolean {
  return pluginTerminals.has(id)
}

async function withPluginTransport(): Promise<PluginTransport | null> {
  if (!(await shouldUsePluginTransport())) {
    return null
  }
  const transport = await getPluginTransport()
  return transport
}

export async function createTerminalBackend(opts: SpawnRequest): Promise<void> {
  const transport = await withPluginTransport()
  if (transport) {
    await transport.spawn({
      id: opts.id,
      cwd: opts.cwd,
      cols: opts.cols ?? 80,
      rows: opts.rows ?? 24,
      env: mapEnv(opts.env),
    })
    pluginTerminals.add(opts.id)
    return
  }

  if (opts.cols != null && opts.rows != null) {
    await invoke(TauriCommands.CreateTerminalWithSize, {
      id: opts.id,
      cwd: opts.cwd,
      cols: opts.cols,
      rows: opts.rows,
    })
  } else {
    await invoke(TauriCommands.CreateTerminal, { id: opts.id, cwd: opts.cwd })
  }
}

export async function createRunTerminalBackend(opts: {
  id: string
  cwd: string
  command: string
  env: Array<[string, string]>
  cols?: number | null
  rows?: number | null
}): Promise<void> {
  const transport = await withPluginTransport()
  if (transport) {
    const cols = opts.cols ?? 80
    const rows = opts.rows ?? 24
    await transport.spawn({
      id: opts.id,
      cwd: opts.cwd,
      cols,
      rows,
      env: opts.env.map(([key, value]) => ({ key, value })),
    })
    pluginTerminals.add(opts.id)
    return
  }

  await invoke(TauriCommands.CreateRunTerminal, {
    id: opts.id,
    cwd: opts.cwd,
    command: opts.command,
    env: opts.env,
    cols: opts.cols ?? null,
    rows: opts.rows ?? null,
  })
}

export async function terminalExistsBackend(id: string): Promise<boolean> {
  const transport = await withPluginTransport()
  if (transport) {
    return pluginTerminals.has(id)
  }
  return invoke<boolean>(TauriCommands.TerminalExists, { id })
}

export async function writeTerminalBackend(id: string, data: string): Promise<void> {
  const transport = await withPluginTransport()
  if (transport && pluginTerminals.has(id)) {
    await transport.write(id, data)
    return
  }
  await invoke(TauriCommands.WriteTerminal, { id, data })
}

export async function resizeTerminalBackend(id: string, cols: number, rows: number): Promise<void> {
  const transport = await withPluginTransport()
  if (transport && pluginTerminals.has(id)) {
    await transport.resize(id, rows, cols)
    return
  }
  await invoke(TauriCommands.ResizeTerminal, { id, cols, rows })
}

export async function closeTerminalBackend(id: string): Promise<void> {
  const transport = await withPluginTransport()
  const handledByPlugin = Boolean(transport && pluginTerminals.has(id))
  if (handledByPlugin) {
    await transport!.kill(id)
    pluginTerminals.delete(id)
  }
  try {
    await invoke(TauriCommands.CloseTerminal, { id })
  } catch (error) {
    if (handledByPlugin) {
      // Legacy manager may not know about plugin terminals; swallow in that case
      logger.debug('[Terminal] closeTerminalBackend fallback failed', error)
      return
    }
    throw error
  }
}

export async function ackTerminalBackend(id: string, seq: number, bytes: number): Promise<void> {
  const transport = await withPluginTransport()
  if (transport && pluginTerminals.has(id)) {
    await transport.ack(id, seq, bytes)
  }
}

export async function subscribeTerminalBackend(
  id: string,
  lastSeenSeq: number,
  onData: (message: { seq: number; bytes: Uint8Array }) => void,
): Promise<() => void> {
  const transport = await withPluginTransport()
  if (transport && pluginTerminals.has(id)) {
    const unsubscribe = await transport.subscribe(id, lastSeenSeq, onData)
    return () => {
      try {
        const result = unsubscribe?.() as unknown
        if (result instanceof Promise) {
          void (result as Promise<void>).catch(error => {
            logger.debug('[TerminalTransport] plugin unsubscribe failed', error)
          })
        }
      } catch (error) {
        logger.debug('[TerminalTransport] revoke plugin listener failed', error)
      }
    }
  }

  // Legacy path handled elsewhere using listenTerminalOutput; return noop
  return () => {}
}
