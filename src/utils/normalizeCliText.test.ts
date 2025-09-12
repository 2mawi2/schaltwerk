import { normalizeSmartPunctuation, containsSmartPunctuation } from './normalizeCliText'

describe('normalizeSmartPunctuation', () => {
  it('replaces em dash with double hyphen', () => {
    expect(normalizeSmartPunctuation('foo —bar')).toBe('foo --bar')
    expect(normalizeSmartPunctuation('—start')).toBe('--start')
  })

  it('replaces en dash with single hyphen', () => {
    expect(normalizeSmartPunctuation('foo –bar')).toBe('foo -bar')
    expect(normalizeSmartPunctuation('–option')).toBe('-option')
  })

  it('replaces curly quotes with straight quotes', () => {
    // Using Unicode escape sequences for curly quotes to avoid parsing issues
    expect(normalizeSmartPunctuation('\u201Ctest\u201D')).toBe('"test"') // "test"
    expect(normalizeSmartPunctuation('\u2018value\u2019')).toBe("'value'") // 'value'
    // Test with the actual curly apostrophe character
    expect(normalizeSmartPunctuation('it\u2019s')).toBe("it's") // it's
  })

  it('handles mixed smart punctuation', () => {
    // Using Unicode escape sequences for all smart punctuation
    expect(normalizeSmartPunctuation('\u2014verbose \u201Ctest\u201D \u2013debug')).toBe('--verbose "test" -debug')
  })

  it('leaves normal ASCII punctuation untouched', () => {
    expect(normalizeSmartPunctuation('--model gpt-4')).toBe('--model gpt-4')
    expect(normalizeSmartPunctuation('-v "test"')).toBe('-v "test"')
    expect(normalizeSmartPunctuation("it's")).toBe("it's")
  })
})

describe('containsSmartPunctuation', () => {
  it('detects em dashes', () => {
    expect(containsSmartPunctuation('—')).toBe(true)
    expect(containsSmartPunctuation('foo—bar')).toBe(true)
  })

  it('detects en dashes', () => {
    expect(containsSmartPunctuation('–')).toBe(true)
    expect(containsSmartPunctuation('foo–bar')).toBe(true)
  })

  it('detects curly quotes', () => {
    expect(containsSmartPunctuation('\u201Ctest\u201D')).toBe(true) // "test"
    expect(containsSmartPunctuation('\u2018test\u2019')).toBe(true) // 'test'
  })

  it('returns false for normal ASCII', () => {
    expect(containsSmartPunctuation('--')).toBe(false)
    expect(containsSmartPunctuation('-')).toBe(false)
    expect(containsSmartPunctuation('"test"')).toBe(false)
    expect(containsSmartPunctuation("'test'")).toBe(false)
  })
})