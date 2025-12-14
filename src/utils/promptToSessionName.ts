import { generateDockerStyleName } from './dockerNames'

const MAX_SESSION_NAME_LENGTH = 40
const DEFAULT_MAX_WORDS = 4

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
    '*': '',
}

function replaceSpecialChars(text: string): string {
    let result = text
    for (const [char, replacement] of Object.entries(SPECIAL_CHAR_MAP)) {
        result = result.split(char).join(replacement)
    }
    return result
}

function extractFirstMeaningfulLine(prompt: string): string {
    const lines = prompt.split('\n')
    for (const line of lines) {
        const trimmed = line.trim()
            .replace(/^#+\s*/, '')
        if (trimmed) {
            return trimmed
        }
    }
    return ''
}

function sanitizePromptLine(line: string): string {
    const withReplacements = replaceSpecialChars(line.toLowerCase())

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

function extractWords(sanitized: string, maxWords: number): string {
    const words = sanitized.split('_').filter(Boolean)
    if (words.length <= maxWords) {
        return sanitized
    }
    return words.slice(0, maxWords).join('_')
}

export function promptToSessionName(
    prompt: string,
    fallback: () => string = generateDockerStyleName
): string {
    if (!prompt || typeof prompt !== 'string') {
        return fallback()
    }

    const firstLine = extractFirstMeaningfulLine(prompt)
    if (!firstLine) {
        return fallback()
    }

    const sanitized = sanitizePromptLine(firstLine)
    if (!sanitized) {
        return fallback()
    }

    const extracted = extractWords(sanitized, DEFAULT_MAX_WORDS)
    return truncateAtWordBoundary(extracted, MAX_SESSION_NAME_LENGTH)
}
