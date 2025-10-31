import { normalizeSmartPunctuation, containsSmartPunctuation, installSmartDashGuards } from './normalizeCliText'

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

describe('installSmartDashGuards', () => {
  let originalExecCommand: (typeof document.execCommand) | undefined
  let execCommandCalls: Array<[string, boolean | undefined, string | undefined]> = []

  beforeAll(() => {
    installSmartDashGuards(document)
  })

  beforeEach(() => {
    const doc = document as unknown as { execCommand?: typeof document.execCommand }
    originalExecCommand = doc.execCommand
    execCommandCalls = []
    doc.execCommand = ((commandId: string, showUI?: boolean, value?: string) => {
      execCommandCalls.push([commandId, showUI, value])
      return true
    }) as typeof document.execCommand
  })

  afterEach(() => {
    const doc = document as unknown as { execCommand?: typeof document.execCommand }
    if (originalExecCommand) {
      doc.execCommand = originalExecCommand
    } else {
      delete doc.execCommand
    }
    originalExecCommand = undefined
    document.body.innerHTML = ''
  })

  it('normalizes smart punctuation for regular beforeinput events', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    const event = new InputEvent('beforeinput', {
      data: '—',
      inputType: 'insertText',
      bubbles: true,
      cancelable: true
    })

    input.dispatchEvent(event)

    expect(event.defaultPrevented).toBe(true)
    expect(execCommandCalls).toEqual([['insertText', false, '--']])
  })

  it('allows composition events to pass through unchanged', () => {
    const input = document.createElement('input')
    document.body.appendChild(input)

    const event = new InputEvent('beforeinput', {
      data: '한',
      inputType: 'insertCompositionText',
      isComposing: true,
      bubbles: true,
      cancelable: true
    })

    const result = input.dispatchEvent(event)

    expect(result).toBe(true)
    expect(event.defaultPrevented).toBe(false)
    expect(execCommandCalls).toHaveLength(0)
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
