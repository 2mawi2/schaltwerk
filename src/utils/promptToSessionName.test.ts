import { describe, expect, it } from 'vitest'
import { promptToSessionName } from './promptToSessionName'

describe('promptToSessionName', () => {
    describe('basic extraction', () => {
        it('extracts first few words from a simple prompt', () => {
            expect(promptToSessionName('Fix the login bug')).toBe('fix_the_login_bug')
        })

        it('extracts up to 4 words by default', () => {
            expect(promptToSessionName('Add user authentication feature to the app')).toBe('add_user_authentication_feature')
        })

        it('uses all words if fewer than max', () => {
            expect(promptToSessionName('Fix bug')).toBe('fix_bug')
        })

        it('handles single word prompts', () => {
            expect(promptToSessionName('Refactor')).toBe('refactor')
        })
    })

    describe('fallback to docker names', () => {
        it('returns fallback for empty string', () => {
            const result = promptToSessionName('')
            expect(result).toMatch(/^[a-z]+_[a-z]+$/)
        })

        it('returns fallback for whitespace only', () => {
            const result = promptToSessionName('   ')
            expect(result).toMatch(/^[a-z]+_[a-z]+$/)
        })

        it('returns fallback for null/undefined', () => {
            expect(promptToSessionName(null as unknown as string)).toMatch(/^[a-z]+_[a-z]+$/)
            expect(promptToSessionName(undefined as unknown as string)).toMatch(/^[a-z]+_[a-z]+$/)
        })

        it('returns fallback when prompt sanitizes to empty', () => {
            const result = promptToSessionName('!!!')
            expect(result).toMatch(/^[a-z]+_[a-z]+$/)
        })

        it('uses provided fallback function when specified', () => {
            const customFallback = () => 'custom_fallback'
            expect(promptToSessionName('', customFallback)).toBe('custom_fallback')
        })
    })

    describe('special character handling', () => {
        it('handles ampersand', () => {
            expect(promptToSessionName('Fix auth & login')).toBe('fix_auth_and_login')
        })

        it('handles plus signs', () => {
            expect(promptToSessionName('Add C++ support now')).toBe('add_c_plus_plus')
        })

        it('handles at signs', () => {
            expect(promptToSessionName('Fix @mention parsing')).toBe('fix_at_mention_parsing')
        })

        it('handles hash signs', () => {
            expect(promptToSessionName('Issue #123 fixes')).toBe('issue_num_123_fixes')
        })

        it('handles percent signs', () => {
            expect(promptToSessionName('100% test coverage')).toBe('100_pct_test_coverage')
        })

        it('handles comparison operators', () => {
            expect(promptToSessionName('a < b')).toBe('a_lt_b')
            expect(promptToSessionName('x > y')).toBe('x_gt_y')
        })

        it('handles separators', () => {
            expect(promptToSessionName('path/to/file update')).toBe('path_to_file_update')
        })

        it('removes punctuation', () => {
            expect(promptToSessionName('Fix bug! How now?')).toBe('fix_bug_how_now')
        })

        it('removes brackets and quotes', () => {
            expect(promptToSessionName('[Feature] Add support')).toBe('feature_add_support')
            expect(promptToSessionName('(WIP) Draft')).toBe('wip_draft')
            expect(promptToSessionName('"quoted" text')).toBe('quoted_text')
        })

        it('collapses multiple consecutive separators', () => {
            expect(promptToSessionName('foo...bar baz')).toBe('foo_bar_baz')
        })
    })

    describe('multiline prompts', () => {
        it('extracts from first line only', () => {
            const prompt = `Fix the login bug
This is a detailed description
with multiple lines`
            expect(promptToSessionName(prompt)).toBe('fix_the_login_bug')
        })

        it('uses second line if first is empty', () => {
            const prompt = `
Fix the bug`
            expect(promptToSessionName(prompt)).toBe('fix_the_bug')
        })

        it('handles prompts with only empty lines', () => {
            const result = promptToSessionName('\n\n\n')
            expect(result).toMatch(/^[a-z]+_[a-z]+$/)
        })
    })

    describe('truncation', () => {
        it('respects max length of 40 characters', () => {
            const longPrompt = 'Implement the comprehensive authentication system upgrade'
            const result = promptToSessionName(longPrompt)
            expect(result.length).toBeLessThanOrEqual(40)
        })

        it('truncates at word boundary when possible', () => {
            const longPrompt = 'Implement comprehensive authentication system for the application'
            const result = promptToSessionName(longPrompt)
            expect(result.length).toBeLessThanOrEqual(40)
            expect(result.endsWith('_')).toBe(false)
        })

        it('handles very long single word', () => {
            const longWord = 'supercalifragilisticexpialidocious'
            const result = promptToSessionName(longWord)
            expect(result.length).toBeLessThanOrEqual(40)
        })
    })

    describe('edge cases', () => {
        it('handles prompt with only numbers', () => {
            expect(promptToSessionName('123 456 789')).toBe('123_456_789')
        })

        it('handles mixed case', () => {
            expect(promptToSessionName('Fix THE Bug')).toBe('fix_the_bug')
        })

        it('handles Unicode characters', () => {
            const result = promptToSessionName('Fixe le bogue français')
            expect(result).toBe('fixe_le_bogue_franais')
        })

        it('handles emoji', () => {
            const result = promptToSessionName('Fix 🐛 bug')
            expect(result).toBe('fix_bug')
        })

        it('handles leading/trailing whitespace', () => {
            expect(promptToSessionName('  Fix the bug  ')).toBe('fix_the_bug')
        })

        it('handles tabs and multiple spaces', () => {
            expect(promptToSessionName('Fix\t\tthe   bug')).toBe('fix_the_bug')
        })

        it('preserves hyphens within words', () => {
            expect(promptToSessionName('Fix user-friendly feature')).toBe('fix_user-friendly_feature')
        })

        it('handles code snippets in prompt', () => {
            expect(promptToSessionName('Fix `getUserById` function')).toBe('fix_getuserbyid_function')
        })

        it('handles markdown headers', () => {
            expect(promptToSessionName('# Fix the bug')).toBe('fix_the_bug')
        })

        it('handles asterisks for bold/italic', () => {
            expect(promptToSessionName('**Fix** the *bug*')).toBe('fix_the_bug')
        })
    })

    describe('consistency with existing titleToSessionName', () => {
        it('produces similar format', () => {
            const result = promptToSessionName('Fix login bug')
            expect(result).toMatch(/^[a-z0-9_-]+$/)
        })
    })
})
