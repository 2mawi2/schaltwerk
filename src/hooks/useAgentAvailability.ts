import { useState, useEffect, useCallback } from 'react'
import { useAgentBinaryDetection, mapAgentToBinary } from './useAgentBinaryDetection'

export interface AgentAvailability {
    agent: string
    available: boolean
    recommendedPath: string | null
    loading: boolean
}

const SUPPORTED_AGENTS = ['claude', 'cursor', 'opencode', 'gemini', 'qwen', 'codex'] as const
type SupportedAgent = typeof SUPPORTED_AGENTS[number]

// Re-export types for backward compatibility
export type { AgentBinaryConfig, DetectedBinary } from './useAgentBinaryDetection'

// Define InstallationMethod for backward compatibility
export enum InstallationMethod {
    Homebrew = 'Homebrew',
    Npm = 'Npm',
    Pip = 'Pip',
    Manual = 'Manual',
    System = 'System',
}

export function useAgentAvailability() {
    const {
        binaryConfigs,
        loading: detectLoading,
        isAgentAvailable: checkAgentAvailable,
        getRecommendedPath: getAgentRecommendedPath,
        refreshAgentBinaryDetection,
        clearCache: clearDetectionCache
    } = useAgentBinaryDetection({ autoLoad: true, cacheResults: true })

    const [availability, setAvailability] = useState<Record<string, AgentAvailability>>(() => {
        // Initialize with optimistic defaults
        const initial: Record<string, AgentAvailability> = {}
        SUPPORTED_AGENTS.forEach(agent => {
            initial[agent] = {
                agent,
                available: true, // Optimistically assume available
                recommendedPath: null,
                loading: false
            }
        })
        return initial
    })

    // Update availability when binary configs change
    useEffect(() => {
        const newAvailability: Record<string, AgentAvailability> = {}
        
        SUPPORTED_AGENTS.forEach(agent => {
            const available = checkAgentAvailable(agent)
            const recommendedPath = getAgentRecommendedPath(agent)
            
            newAvailability[agent] = {
                agent,
                available,
                recommendedPath,
                loading: false
            }
        })
        
        setAvailability(newAvailability)
    }, [binaryConfigs, checkAgentAvailable, getAgentRecommendedPath])

    const isAvailable = useCallback((agentName: string): boolean => {
        return availability[agentName]?.available ?? true // Default to true (optimistic)
    }, [availability])

    const getRecommendedPath = useCallback((agentName: string): string | null => {
        return availability[agentName]?.recommendedPath ?? null
    }, [availability])

    const getInstallationMethod = useCallback((agentName: string): string | null => {
        const binaryName = mapAgentToBinary(agentName)
        const config = binaryConfigs[binaryName]
        
        if (!config) return null
        
        if (config.custom_path) {
            return 'Manual'
        }
        
        const recommended = config.detected_binaries.find(b => b.is_recommended)
        return recommended?.installation_method ?? null
    }, [binaryConfigs])

    const refreshAvailability = useCallback(async () => {
        // Refresh all agents
        const refreshPromises = SUPPORTED_AGENTS.map(agent => 
            refreshAgentBinaryDetection(agent)
        )
        await Promise.all(refreshPromises)
    }, [refreshAgentBinaryDetection])

    const refreshSingleAgent = useCallback(async (agentName: string) => {
        if (!SUPPORTED_AGENTS.includes(agentName as SupportedAgent)) {
            return
        }
        await refreshAgentBinaryDetection(agentName)
    }, [refreshAgentBinaryDetection])

    const clearCache = useCallback(() => {
        clearDetectionCache()
    }, [clearDetectionCache])

    const forceRefresh = useCallback(() => {
        clearCache()
    }, [clearCache])

    return {
        availability,
        loading: detectLoading,
        isAvailable,
        getRecommendedPath,
        getInstallationMethod,
        refreshAvailability,
        refreshSingleAgent,
        clearCache,
        forceRefresh,
    }
}