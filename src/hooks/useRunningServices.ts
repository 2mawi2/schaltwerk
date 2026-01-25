/**
 * Hook for managing and querying running services in the project dashboard.
 */

import { useState, useEffect, useCallback } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../common/tauriCommands'
import { listenEvent, SchaltEvent } from '../common/eventSystem'
import type { RunningService, RegisterServiceRequest, ServicesListResponse } from '../types/services'

interface UseRunningServicesOptions {
    /** Filter by session name */
    sessionName?: string
    /** Polling interval in milliseconds (0 to disable) */
    pollInterval?: number
}

interface UseRunningServicesResult {
    /** List of running services */
    services: RunningService[]
    /** Whether the services are currently loading */
    loading: boolean
    /** Any error that occurred */
    error: string | null
    /** Refresh the services list */
    refresh: () => Promise<void>
    /** Register a new service */
    registerService: (request: RegisterServiceRequest) => Promise<RunningService>
    /** Unregister a service by ID */
    unregisterService: (id: string) => Promise<void>
    /** Unregister all services for a terminal */
    unregisterByTerminal: (terminalId: string) => Promise<void>
    /** Clear all services */
    clearAll: () => Promise<void>
}

export function useRunningServices(options: UseRunningServicesOptions = {}): UseRunningServicesResult {
    const { sessionName, pollInterval = 0 } = options
    const [services, setServices] = useState<RunningService[]>([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState<string | null>(null)

    const refresh = useCallback(async () => {
        try {
            setError(null)
            const response: ServicesListResponse = sessionName
                ? await invoke(TauriCommands.ListRunningServicesBySession, { sessionName })
                : await invoke(TauriCommands.ListRunningServices)
            setServices(response.services)
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            setError(message)
            console.error('Failed to fetch running services:', err)
        } finally {
            setLoading(false)
        }
    }, [sessionName])

    const registerService = useCallback(async (request: RegisterServiceRequest): Promise<RunningService> => {
        const service: RunningService = await invoke(TauriCommands.RegisterRunningService, { request })
        await refresh()
        return service
    }, [refresh])

    const unregisterService = useCallback(async (id: string): Promise<void> => {
        await invoke(TauriCommands.UnregisterRunningService, { id })
        await refresh()
    }, [refresh])

    const unregisterByTerminal = useCallback(async (terminalId: string): Promise<void> => {
        await invoke(TauriCommands.UnregisterRunningServicesByTerminal, { terminalId })
        await refresh()
    }, [refresh])

    const clearAll = useCallback(async (): Promise<void> => {
        await invoke(TauriCommands.ClearRunningServices)
        await refresh()
    }, [refresh])

    // Initial load
    useEffect(() => {
        void refresh()
    }, [refresh])

    // Set up polling if enabled
    useEffect(() => {
        if (pollInterval <= 0) return

        const interval = setInterval(refresh, pollInterval)
        return () => clearInterval(interval)
    }, [pollInterval, refresh])

    // Listen for terminal close events to refresh (services may need to be removed)
    useEffect(() => {
        let unlisten: (() => void) | null = null
        
        void listenEvent(SchaltEvent.TerminalClosed, () => {
            void refresh()
        }).then(fn => {
            unlisten = fn
        })
        
        return () => {
            unlisten?.()
        }
    }, [refresh])

    return {
        services,
        loading,
        error,
        refresh,
        registerService,
        unregisterService,
        unregisterByTerminal,
        clearAll,
    }
}
