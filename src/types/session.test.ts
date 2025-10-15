import { describe, expect, it } from 'vitest'
import { AGENT_TYPES, createAgentRecord } from './session'

describe('session agent constants', () => {
  it('exposes the supported agents in a stable order', () => {
    expect(AGENT_TYPES).toEqual(['claude', 'opencode', 'gemini', 'codex', 'droid', 'qwen', 'terminal'])
  })

  it('createAgentRecord maps every agent type', () => {
    const record = createAgentRecord(agent => agent.toUpperCase())
    expect(Object.keys(record)).toHaveLength(AGENT_TYPES.length)
    AGENT_TYPES.forEach(agent => {
      expect(record[agent]).toBe(agent.toUpperCase())
    })
  })
})
