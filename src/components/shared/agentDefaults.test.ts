import { describe, expect, it } from 'vitest'
import { displayNameForAgent } from './agentDefaults'
import { AgentType } from '../../types/session'

describe('displayNameForAgent', () => {
  it('labels the copilot agent with its GitHub branding', () => {
    const name = displayNameForAgent('copilot' satisfies AgentType)
    expect(name).toBe('GitHub Copilot')
  })

  it('falls back to Claude for agents without explicit overrides', () => {
    const name = displayNameForAgent('claude')
    expect(name).toBe('Claude')
  })
})
