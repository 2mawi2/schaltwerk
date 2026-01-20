import { describe, it, expect } from 'vitest'
import { getPasteSubmissionOptions } from './terminalPaste'

describe('getPasteSubmissionOptions', () => {
  it('returns no brackets and delayed submit for claude', () => {
    const result = getPasteSubmissionOptions('claude')
    expect(result).toEqual({ useBracketedPaste: false, needsDelayedSubmit: true })
  })

  it('returns no brackets and delayed submit for droid', () => {
    const result = getPasteSubmissionOptions('droid')
    expect(result).toEqual({ useBracketedPaste: false, needsDelayedSubmit: true })
  })

  it('returns brackets and delayed submit for kilocode (TUI agent)', () => {
    const result = getPasteSubmissionOptions('kilocode')
    expect(result).toEqual({ useBracketedPaste: true, needsDelayedSubmit: true })
  })

  it('returns brackets and immediate submit for standard agents', () => {
    expect(getPasteSubmissionOptions('codex')).toEqual({ useBracketedPaste: true, needsDelayedSubmit: false })
    expect(getPasteSubmissionOptions('gemini')).toEqual({ useBracketedPaste: true, needsDelayedSubmit: false })
    expect(getPasteSubmissionOptions('opencode')).toEqual({ useBracketedPaste: true, needsDelayedSubmit: true })
  })

  it('returns default for undefined agent type', () => {
    expect(getPasteSubmissionOptions(undefined)).toEqual({ useBracketedPaste: true, needsDelayedSubmit: false })
  })

  it('returns default for null agent type', () => {
    expect(getPasteSubmissionOptions(null)).toEqual({ useBracketedPaste: true, needsDelayedSubmit: false })
  })
})
