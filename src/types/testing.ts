import type { Event } from '@tauri-apps/api/event'
import { EnrichedSession, SessionMonitorStatus } from './session'

export type MockTauriInvokeArgs = Record<string, unknown> | any

export type MockEventHandler<T = unknown> = (event: Event<T>) => void

export interface MockSessionData extends Partial<EnrichedSession> {
  id?: string
  name?: string
  status?: SessionMonitorStatus
  branch?: string
  [key: string]: unknown
}

export type MockComponent = React.ComponentType<Record<string, unknown>>

export interface TauriEventMock {
  event: string
  handler: (event: Event<unknown>) => void
}

export interface SessionMockData {
  sessions?: MockSessionData[]
  currentSession?: MockSessionData | null
  selectedSession?: MockSessionData | null
}