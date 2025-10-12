import { describe, it, expect, beforeEach } from 'vitest'
import {
  shouldUseExtendedAgentTimeout,
  recordAgentLifecycle,
  resetAgentLifecycleStateForTests,
} from './agentLifecycleTracker'

describe('agentLifecycleTracker', () => {
  beforeEach(() => {
    resetAgentLifecycleStateForTests()
  })

  it('uses extended timeout before any agent has reported ready', () => {
    expect(shouldUseExtendedAgentTimeout('claude')).toBe(true)
    expect(shouldUseExtendedAgentTimeout('codex')).toBe(true)
  })

  it('sticks with extended timeout while codex indexing is pending', () => {
    recordAgentLifecycle({
      terminalId: 'session-codex-top',
      state: 'spawned',
      agentType: 'codex',
    })

    expect(shouldUseExtendedAgentTimeout('claude')).toBe(true)
    expect(shouldUseExtendedAgentTimeout('codex')).toBe(true)

    recordAgentLifecycle({
      terminalId: 'session-codex-top',
      state: 'ready',
      agentType: 'codex',
    })

    expect(shouldUseExtendedAgentTimeout('codex')).toBe(false)
  })

  it('drops to warm timeout after any agent reports ready', () => {
    recordAgentLifecycle({
      terminalId: 'session-claude-top',
      state: 'ready',
      agentType: 'claude',
    })

    expect(shouldUseExtendedAgentTimeout('claude')).toBe(false)
    expect(shouldUseExtendedAgentTimeout('codex')).toBe(true)
  })
})
