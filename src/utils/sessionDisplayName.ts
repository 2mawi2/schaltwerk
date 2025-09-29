import type { SessionInfo } from '../types/session'

type SessionDisplaySource = Pick<SessionInfo, 'session_id' | 'display_name'> | {
    session_id: string
    display_name?: string | null
}

export function getSessionDisplayName(info: SessionDisplaySource): string {
    return info.display_name || info.session_id
}
