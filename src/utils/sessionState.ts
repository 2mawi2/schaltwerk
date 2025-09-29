import type { SessionInfo } from '../types/session'
import { SessionState } from '../types/session'

type SessionStateSource = Pick<SessionInfo, 'session_state' | 'status' | 'ready_to_merge'>

export type SessionUiState = SessionState.Spec | SessionState.Running | SessionState.Reviewed

export function mapSessionUiState(info: SessionStateSource): SessionUiState {
    if (info.session_state === SessionState.Spec || info.status === 'spec') {
        return SessionState.Spec
    }

    if (info.ready_to_merge) {
        return SessionState.Reviewed
    }

    return SessionState.Running
}

export function isSpec(info: SessionStateSource): boolean {
    return mapSessionUiState(info) === SessionState.Spec
}

export function isReviewed(info: SessionStateSource): boolean {
    return mapSessionUiState(info) === SessionState.Reviewed
}

export function isRunning(info: SessionStateSource): boolean {
    return mapSessionUiState(info) === SessionState.Running
}
