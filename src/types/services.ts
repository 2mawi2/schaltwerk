/**
 * Types for the running services / project dashboard feature.
 */

export type ServiceStatus = 'running' | 'starting' | 'stopped' | 'unknown'

export interface RunningService {
    /** Unique identifier for this service entry */
    id: string
    /** Display name (e.g., "Next.js Dev Server", "Vite") */
    name: string
    /** Port number the service is listening on */
    port: number
    /** Full URL to access the service */
    url: string
    /** Terminal ID where the service was started */
    terminal_id: string | null
    /** Session name associated with this service */
    session_name: string | null
    /** Unix timestamp when the service was registered */
    started_at: number
    /** Optional process ID */
    pid: number | null
    /** Service status */
    status: ServiceStatus
    /** Additional metadata */
    metadata: Record<string, string>
}

export interface RegisterServiceRequest {
    name: string
    port: number
    url?: string
    terminal_id?: string
    session_name?: string
    pid?: number
    metadata?: Record<string, string>
}

export interface ServicesListResponse {
    services: RunningService[]
}
