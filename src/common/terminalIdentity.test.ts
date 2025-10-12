import { describe, it, expect } from 'vitest'
import {
  sanitizeSessionName,
  sessionTerminalHash,
  sessionTerminalBase,
  stableSessionTerminalId,
  sessionTerminalGroup,
  isTopTerminalId
} from './terminalIdentity'

describe('terminalIdentity helpers', () => {
  it('sanitizes session names while preserving safe characters', () => {
    expect(sanitizeSessionName('alpha beta/42')).toBe('alpha_beta_42')
    expect(sanitizeSessionName('my-session_name')).toBe('my-session_name')
  })

  it('replaces disallowed characters while preserving length and uses "unknown" when truly empty', () => {
    expect(sanitizeSessionName('////')).toBe('____')
    expect(sanitizeSessionName('')).toBe('unknown')
    expect(sanitizeSessionName(null)).toBe('unknown')
    expect(sanitizeSessionName(undefined)).toBe('unknown')
  })

  it('produces stable hash fragments for identical names', () => {
    const first = sessionTerminalHash('alpha beta')
    const second = sessionTerminalHash('alpha beta')
    expect(first).toBe(second)
  })

  it('creates base IDs that embed sanitized name and hash fragment', () => {
    const base = sessionTerminalBase('alpha beta')
    expect(base.startsWith('session-alpha_beta~')).toBe(true)
    expect(base.length).toBeGreaterThan('session-alpha_beta~'.length)
  })

  it('generates distinct stable terminal IDs for similar names that sanitize to same string', () => {
    const first = stableSessionTerminalId('alpha beta', 'top')
    const second = stableSessionTerminalId('alpha?beta', 'top')
    expect(first).not.toBe(second)
  })

  it('returns consistent terminal group identifiers', () => {
    const group = sessionTerminalGroup('alpha beta')
    expect(group.top).toBe(`${group.base}-top`)
    expect(group.bottomBase).toBe(`${group.base}-bottom`)
  })

  it('identifies top terminals across naming schemes', () => {
    const base = sessionTerminalBase('dreamy_kirch')
    expect(isTopTerminalId(`${base}-top`)).toBe(true)
    expect(isTopTerminalId(`${base}-bottom`)).toBe(false)
    expect(isTopTerminalId(`${base}-top-0`)).toBe(true)
    expect(isTopTerminalId('orchestrator-main-top')).toBe(true)
    expect(isTopTerminalId('orchestrator-main-bottom')).toBe(false)
    expect(isTopTerminalId('run-terminal-main')).toBe(false)
  })
})
