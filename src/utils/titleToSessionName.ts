const MAX_SESSION_NAME_LENGTH = 40

const SPECIAL_CHAR_MAP: Record<string, string> = {
    '&': '_and_',
    '+': '_plus_',
    '@': '_at_',
    '#': '_num_',
    '%': '_pct_',
    '=': '_eq_',
    '<': '_lt_',
    '>': '_gt_',
    '/': '_',
    '\\': '_',
    '|': '_',
    ':': '_',
    ';': '_',
    ',': '_',
    '.': '_',
    '!': '',
    '?': '',
    "'": '',
    '"': '',
    '`': '',
    '(': '',
    ')': '',
    '[': '',
    ']': '',
    '{': '',
    '}': '',
}

function replaceSpecialChars(text: string): string {
    let result = text
    for (const [char, replacement] of Object.entries(SPECIAL_CHAR_MAP)) {
        result = result.split(char).join(replacement)
    }
    return result
}

function sanitizeTitle(title: string): string {
    const withReplacements = replaceSpecialChars(title.toLowerCase())

    return withReplacements
        .replace(/[^a-z0-9\s_-]/g, '')
        .trim()
        .replace(/\s+/g, '_')
        .replace(/[-_]{2,}/g, '_')
        .replace(/^[-_]+|[-_]+$/g, '')
}

function truncateAtWordBoundary(text: string, maxLength: number): string {
    if (text.length <= maxLength) {
        return text
    }

    const truncated = text.slice(0, maxLength)
    const lastUnderscore = truncated.lastIndexOf('_')
    const lastHyphen = truncated.lastIndexOf('-')
    const lastBoundary = Math.max(lastUnderscore, lastHyphen)

    if (lastBoundary > maxLength * 0.5) {
        return truncated.slice(0, lastBoundary)
    }

    return truncated.replace(/[-_]+$/, '')
}

export function titleToSessionName(title: string, issueNumber?: number): string {
    if (!title || typeof title !== 'string') {
        if (issueNumber !== undefined) {
            return String(issueNumber)
        }
        return ''
    }

    const sanitized = sanitizeTitle(title)

    if (!sanitized) {
        if (issueNumber !== undefined) {
            return String(issueNumber)
        }
        return ''
    }

    if (issueNumber !== undefined) {
        const prefix = `${issueNumber}_`
        const availableLength = MAX_SESSION_NAME_LENGTH - prefix.length
        const truncatedTitle = truncateAtWordBoundary(sanitized, availableLength)
        return `${prefix}${truncatedTitle}`
    }

    return truncateAtWordBoundary(sanitized, MAX_SESSION_NAME_LENGTH)
}
