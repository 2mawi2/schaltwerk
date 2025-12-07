import { describe, expect, it, beforeEach } from 'vitest'
import { determineRunModeState } from './runModeLogic'

describe('runModeLogic', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  describe('determineRunModeState', () => {
    it('returns isFirstVisit true on first access', () => {
      const state = determineRunModeState('test-session')
      expect(state.isFirstVisit).toBe(true)
    })

    it('returns isFirstVisit false on subsequent access', () => {
      determineRunModeState('test-session')
      const state = determineRunModeState('test-session')
      expect(state.isFirstVisit).toBe(false)
    })

    it('returns shouldActivateRunMode false when not persisted', () => {
      const state = determineRunModeState('test-session')
      expect(state.shouldActivateRunMode).toBe(false)
    })

    it('returns shouldActivateRunMode true when persisted as true', () => {
      sessionStorage.setItem('schaltwerk:run-mode:test-session', 'true')
      const state = determineRunModeState('test-session')
      expect(state.shouldActivateRunMode).toBe(true)
    })

    it('returns shouldActivateRunMode false when persisted as false', () => {
      sessionStorage.setItem('schaltwerk:run-mode:test-session', 'false')
      const state = determineRunModeState('test-session')
      expect(state.shouldActivateRunMode).toBe(false)
    })

    it('returns savedActiveTab as -1 (RUN_TAB_INDEX) when persisted', () => {
      sessionStorage.setItem('schaltwerk:active-tab:test-session', '-1')
      const state = determineRunModeState('test-session')
      expect(state.savedActiveTab).toBe(-1)
    })

    it('returns savedActiveTab as null when not persisted', () => {
      const state = determineRunModeState('test-session')
      expect(state.savedActiveTab).toBe(null)
    })
  })

  describe('run mode persistence across session switches (regression test)', () => {
    const RUN_TAB_INDEX = -1

    function persistRunModeState(sessionKey: string, isActive: boolean): void {
      const runModeKey = `schaltwerk:run-mode:${sessionKey}`
      sessionStorage.setItem(runModeKey, String(isActive))
    }

    function persistActiveTab(sessionKey: string, tabIndex: number): void {
      const activeTabKey = `schaltwerk:active-tab:${sessionKey}`
      sessionStorage.setItem(activeTabKey, String(tabIndex))
    }

    it('restores run mode state after switching sessions', () => {
      const orchestratorKey = 'orchestrator'
      const sessionBKey = 'session-b'

      persistRunModeState(orchestratorKey, true)
      persistActiveTab(orchestratorKey, RUN_TAB_INDEX)

      const stateBeforeSwitch = determineRunModeState(orchestratorKey)
      expect(stateBeforeSwitch.shouldActivateRunMode).toBe(true)
      expect(stateBeforeSwitch.savedActiveTab).toBe(RUN_TAB_INDEX)

      determineRunModeState(sessionBKey)

      const stateAfterSwitch = determineRunModeState(orchestratorKey)
      expect(stateAfterSwitch.shouldActivateRunMode).toBe(true)
      expect(stateAfterSwitch.savedActiveTab).toBe(RUN_TAB_INDEX)
    })

    it('maintains separate run mode state per session', () => {
      const sessionA = 'session-a'
      const sessionB = 'session-b'

      persistRunModeState(sessionA, true)
      persistActiveTab(sessionA, RUN_TAB_INDEX)

      persistRunModeState(sessionB, false)
      persistActiveTab(sessionB, 0)

      const stateA = determineRunModeState(sessionA)
      expect(stateA.shouldActivateRunMode).toBe(true)
      expect(stateA.savedActiveTab).toBe(RUN_TAB_INDEX)

      const stateB = determineRunModeState(sessionB)
      expect(stateB.shouldActivateRunMode).toBe(false)
      expect(stateB.savedActiveTab).toBe(0)
    })

    it('preserves run mode when switching orchestrator -> session -> orchestrator', () => {
      const orchestrator = 'orchestrator'
      const session = 'test-session'

      persistRunModeState(orchestrator, true)
      persistActiveTab(orchestrator, RUN_TAB_INDEX)

      const initial = determineRunModeState(orchestrator)
      expect(initial.shouldActivateRunMode).toBe(true)

      determineRunModeState(session)

      const restored = determineRunModeState(orchestrator)
      expect(restored.shouldActivateRunMode).toBe(true)
      expect(restored.savedActiveTab).toBe(RUN_TAB_INDEX)
    })
  })
})
