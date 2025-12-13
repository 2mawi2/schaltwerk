import { describe, expect, it } from 'vitest'
import { AGENT_TYPES, AGENT_SUPPORTS_SKIP_PERMISSIONS, createAgentRecord } from './session'

describe('session agent constants', () => {
  it('exposes the supported agents in a stable order', () => {
    expect(AGENT_TYPES).toEqual([
      'claude',
      'copilot',
      'opencode',
      'gemini',
      'codex',
      'droid',
      'qwen',
      'amp',
      'kilocode',
      'terminal',
    ])
  })

  it('createAgentRecord maps every agent type', () => {
    const record = createAgentRecord(agent => agent.toUpperCase())
    expect(Object.keys(record)).toHaveLength(AGENT_TYPES.length)
    AGENT_TYPES.forEach(agent => {
      expect(record[agent]).toBe(agent.toUpperCase())
    })
  })

  it('defines skip-permission support for every agent', () => {
    expect(Object.keys(AGENT_SUPPORTS_SKIP_PERMISSIONS)).toEqual(AGENT_TYPES)
    expect(AGENT_SUPPORTS_SKIP_PERMISSIONS.copilot).toBe(true)
    expect(AGENT_SUPPORTS_SKIP_PERMISSIONS.kilocode).toBe(true)
  })
})
