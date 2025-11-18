import { useCallback, useEffect, useMemo, useState } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { logger } from '../utils/logger'

export interface DetectedBinary {
  path: string
  installation_method: string
  version?: string | null
}

export interface AgentBinarySnapshot {
  agent_name: string
  custom_path: string | null
  auto_detect: boolean
  detected_binaries: DetectedBinary[]
}

export interface AgentBinaryStatus {
  config: AgentBinarySnapshot
  status: 'present' | 'missing'
  preferredPath: string | null
}

interface SnapshotState {
  loading: boolean
  error: string | null
  items: AgentBinarySnapshot[]
}

function pickPreferredPath(config: AgentBinarySnapshot): string | null {
  const custom = config.custom_path?.trim()
  if (custom) return custom
  return config.detected_binaries[0]?.path ?? null
}

export function useAgentBinarySnapshot() {
  const [state, setState] = useState<SnapshotState>({ loading: true, error: null, items: [] })

  const load = useCallback(async () => {
    setState(prev => ({ ...prev, loading: true, error: null }))
    try {
      const result = await invoke<AgentBinarySnapshot[]>(TauriCommands.GetAllAgentBinaryConfigs)
      setState({ loading: false, error: null, items: result })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      logger.warn('[useAgentBinarySnapshot] failed to load agent binaries', error)
      setState({ loading: false, error: message, items: [] })
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  const statusByAgent = useMemo<Record<string, AgentBinaryStatus>>(() => {
    const map: Record<string, AgentBinaryStatus> = {}
    for (const cfg of state.items) {
      const preferredPath = pickPreferredPath(cfg)
      map[cfg.agent_name] = {
        config: cfg,
        status: preferredPath ? 'present' : 'missing',
        preferredPath,
      }
    }
    return map
  }, [state.items])

  const allMissing = useMemo(() => {
    if (state.items.length === 0) return false
    return state.items.every(cfg => !pickPreferredPath(cfg))
  }, [state.items])

  return {
    loading: state.loading,
    error: state.error,
    items: state.items,
    statusByAgent,
    allMissing,
    refresh: load,
  }
}
