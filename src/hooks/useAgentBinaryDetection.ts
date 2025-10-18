import { useState, useEffect, useCallback } from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { invoke } from '@tauri-apps/api/core'
import { logger } from '../utils/logger'

export interface DetectedBinary {
    path: string
    version?: string
    installation_method: string
    is_recommended: boolean
    is_symlink: boolean
    symlink_target?: string
}

export interface AgentBinaryConfig {
    agent_name: string
    custom_path: string | null
    auto_detect: boolean
    detected_binaries: DetectedBinary[]
}

export type AgentType = 'claude' | 'opencode' | 'gemini' | 'codex' | 'droid' | 'qwen' | 'amp' | 'terminal'

// UI agent names to backend agent names mapping
const AGENT_TO_BINARY_MAPPING: Record<string, AgentType> = {
    'claude': 'claude',
    'opencode': 'opencode',
    'gemini': 'gemini',
    'codex': 'codex',
    'droid': 'droid',
    'qwen': 'qwen',
    'amp': 'amp'
}

export function mapAgentToBinary(agentName: string): AgentType {
    return AGENT_TO_BINARY_MAPPING[agentName] as AgentType || agentName as AgentType
}

interface UseAgentBinaryDetectionOptions {
    autoLoad?: boolean
    cacheResults?: boolean
}

const DEFAULT_CONFIGS: Record<string, AgentBinaryConfig> = {
    'claude': { agent_name: 'claude', custom_path: null, auto_detect: true, detected_binaries: [] },
    'opencode': { agent_name: 'opencode', custom_path: null, auto_detect: true, detected_binaries: [] },
    'gemini': { agent_name: 'gemini', custom_path: null, auto_detect: true, detected_binaries: [] },
    'codex': { agent_name: 'codex', custom_path: null, auto_detect: true, detected_binaries: [] },
    'droid': { agent_name: 'droid', custom_path: null, auto_detect: true, detected_binaries: [] },
    'qwen': { agent_name: 'qwen', custom_path: null, auto_detect: true, detected_binaries: [] },
    'amp': { agent_name: 'amp', custom_path: null, auto_detect: true, detected_binaries: [] }
}

// Cache for binary configs to avoid repeated backend calls
const configCache = new Map<AgentType, { config: AgentBinaryConfig; timestamp: number }>()
const CACHE_DURATION = 5 * 60 * 1000 // 5 minutes

export function useAgentBinaryDetection(options: UseAgentBinaryDetectionOptions = {}) {
    const { autoLoad = true, cacheResults = true } = options
    const [binaryConfigs, setBinaryConfigs] = useState<Record<string, AgentBinaryConfig>>(DEFAULT_CONFIGS)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState<string | null>(null)

    // Get cached config if available and fresh
    const getCachedConfig = useCallback((agentName: AgentType): AgentBinaryConfig | null => {
        if (!cacheResults) return null
        
        const cached = configCache.get(agentName)
        if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
            return cached.config
        }
        return null
    }, [cacheResults])

    // Cache a config
    const setCachedConfig = useCallback((agentName: AgentType, config: AgentBinaryConfig) => {
        if (!cacheResults) return
        configCache.set(agentName, { config, timestamp: Date.now() })
    }, [cacheResults])

    // Load all binary configurations
    const loadAllBinaryConfigs = useCallback(async () => {
        try {
            setLoading(true)
            setError(null)

            const configs = await invoke<AgentBinaryConfig[]>(TauriCommands.GetAllAgentBinaryConfigs)

            const configMap: Record<string, AgentBinaryConfig> = { ...DEFAULT_CONFIGS }

            configs.forEach(config => {
                const agentType = config.agent_name as AgentType
                configMap[agentType] = config
                if (agentType !== 'terminal') {
                    setCachedConfig(agentType, config)
                }
            })

            setBinaryConfigs(configMap)
        } catch (err) {
            logger.error('Failed to load binary configurations:', err)
            setError(String(err))
        } finally {
            setLoading(false)
        }
    }, [setCachedConfig])

    // Get config for a specific agent
    const getAgentBinaryConfig = useCallback(async (agentName: string): Promise<AgentBinaryConfig | null> => {
        try {
            const binaryName = mapAgentToBinary(agentName)

            if (binaryName === 'terminal') {
                return null
            }

            // Check cache first
            const cached = getCachedConfig(binaryName)
            if (cached) {
                return cached
            }

            const config = await invoke<AgentBinaryConfig>(TauriCommands.GetAgentBinaryConfig, {
                agentName: binaryName
            })

            setCachedConfig(binaryName, config)
            setBinaryConfigs(prev => ({
                ...prev,
                [binaryName]: config
            }))

            return config
        } catch (err) {
            logger.error(`Failed to get binary config for ${agentName}:`, err)
            return null
        }
    }, [getCachedConfig, setCachedConfig])

    // Refresh binary detection for a specific agent
    const refreshAgentBinaryDetection = useCallback(async (agentName: string): Promise<AgentBinaryConfig | null> => {
        try {
            const binaryName = mapAgentToBinary(agentName)

            if (binaryName === 'terminal') {
                return null
            }

            const config = await invoke<AgentBinaryConfig>(TauriCommands.RefreshAgentBinaryDetection, {
                agentName: binaryName
            })

            setCachedConfig(binaryName, config)
            setBinaryConfigs(prev => ({
                ...prev,
                [binaryName]: config
            }))

            return config
        } catch (err) {
            logger.error(`Failed to refresh binary detection for ${agentName}:`, err)
            return null
        }
    }, [setCachedConfig])

    // Set custom binary path for an agent
    const setAgentBinaryPath = useCallback(async (agentName: string, path: string | null): Promise<boolean> => {
        try {
            const binaryName = mapAgentToBinary(agentName)

            if (binaryName === 'terminal') {
                return false
            }

            await invoke(TauriCommands.SetAgentBinaryPath, {
                agentName: binaryName,
                path: path || null
            })

            // Get the updated config
            const updatedConfig = await invoke<AgentBinaryConfig>(TauriCommands.GetAgentBinaryConfig, {
                agentName: binaryName
            })

            setCachedConfig(binaryName, updatedConfig)
            setBinaryConfigs(prev => ({
                ...prev,
                [binaryName]: updatedConfig
            }))

            return true
        } catch (err) {
            logger.error(`Failed to set binary path for ${agentName}:`, err)
            return false
        }
    }, [setCachedConfig])

    // Check if an agent is available
    const isAgentAvailable = useCallback((agentName: string): boolean => {
        const binaryName = mapAgentToBinary(agentName)

        if (binaryName === 'terminal') {
            return true
        }

        const config = binaryConfigs[binaryName]

        if (!config) return false

        // Agent is available if it has a custom path or detected binaries
        return Boolean(config.custom_path) || config.detected_binaries.length > 0
    }, [binaryConfigs])

    // Get the recommended binary path for an agent
    const getRecommendedPath = useCallback((agentName: string): string | null => {
        const binaryName = mapAgentToBinary(agentName)

        if (binaryName === 'terminal') {
            return null
        }

        const config = binaryConfigs[binaryName]

        if (!config) return null

        // Custom path takes precedence
        if (config.custom_path) {
            return config.custom_path
        }

        // Otherwise find the recommended binary
        const recommended = config.detected_binaries.find(b => b.is_recommended)
        return recommended?.path || config.detected_binaries[0]?.path || null
    }, [binaryConfigs])

    // Clear cache
    const clearCache = useCallback(() => {
        configCache.clear()
        if (autoLoad) {
            loadAllBinaryConfigs()
        }
    }, [autoLoad, loadAllBinaryConfigs])

    // Auto-load on mount if requested
    useEffect(() => {
        if (autoLoad) {
            loadAllBinaryConfigs()
        }
    }, [autoLoad, loadAllBinaryConfigs])

    return {
        binaryConfigs,
        loading,
        error,
        loadAllBinaryConfigs,
        getAgentBinaryConfig,
        refreshAgentBinaryDetection,
        setAgentBinaryPath,
        isAgentAvailable,
        getRecommendedPath,
        clearCache,
    }
}
