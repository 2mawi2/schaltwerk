import { describe, expect, it } from 'vitest'
import { titleToSessionName } from './titleToSessionName'

describe('titleToSessionName', () => {
    describe('basic transformations', () => {
        it('converts simple title to lowercase with underscores', () => {
            expect(titleToSessionName('Fix login bug')).toBe('fix_login_bug')
        })

        it('preserves hyphens', () => {
            expect(titleToSessionName('fix-bug-123')).toBe('fix-bug-123')
            expect(titleToSessionName('Add user-friendly UI')).toBe('add_user-friendly_ui')
        })

        it('handles empty and invalid inputs', () => {
            expect(titleToSessionName('')).toBe('')
            expect(titleToSessionName('   ')).toBe('')
            expect(titleToSessionName(null as unknown as string)).toBe('')
            expect(titleToSessionName(undefined as unknown as string)).toBe('')
        })

        it('handles consecutive spaces', () => {
            expect(titleToSessionName('Fix   multiple   spaces')).toBe('fix_multiple_spaces')
        })

        it('trims leading and trailing separators', () => {
            expect(titleToSessionName('_leading_underscore')).toBe('leading_underscore')
            expect(titleToSessionName('trailing_underscore_')).toBe('trailing_underscore')
            expect(titleToSessionName('-leading-hyphen')).toBe('leading-hyphen')
        })
    })

    describe('special character handling', () => {
        it('converts ampersand to _and_', () => {
            expect(titleToSessionName('foo & bar')).toBe('foo_and_bar')
            expect(titleToSessionName('A&B test')).toBe('a_and_b_test')
        })

        it('converts plus to _plus_', () => {
            expect(titleToSessionName('C++ support')).toBe('c_plus_plus_support')
            expect(titleToSessionName('Add + feature')).toBe('add_plus_feature')
        })

        it('converts at sign to _at_', () => {
            expect(titleToSessionName('Fix @mention handling')).toBe('fix_at_mention_handling')
        })

        it('converts hash to _num_', () => {
            expect(titleToSessionName('Issue #123 fix')).toBe('issue_num_123_fix')
        })

        it('converts percent to _pct_', () => {
            expect(titleToSessionName('100% coverage')).toBe('100_pct_coverage')
        })

        it('converts comparison operators', () => {
            expect(titleToSessionName('a < b > c')).toBe('a_lt_b_gt_c')
            expect(titleToSessionName('x = y')).toBe('x_eq_y')
        })

        it('converts separators to underscores', () => {
            expect(titleToSessionName('path/to/file')).toBe('path_to_file')
            expect(titleToSessionName('foo: bar')).toBe('foo_bar')
            expect(titleToSessionName('a, b, c')).toBe('a_b_c')
            expect(titleToSessionName('version 1.2.3')).toBe('version_1_2_3')
        })

        it('removes punctuation', () => {
            expect(titleToSessionName('Hello! How are you?')).toBe('hello_how_are_you')
            expect(titleToSessionName("It's working")).toBe('its_working')
        })

        it('removes brackets and quotes', () => {
            expect(titleToSessionName('[Feature] Add support')).toBe('feature_add_support')
            expect(titleToSessionName('(WIP) Draft PR')).toBe('wip_draft_pr')
            expect(titleToSessionName('{config} update')).toBe('config_update')
            expect(titleToSessionName('"quoted" text')).toBe('quoted_text')
        })

        it('collapses multiple consecutive separators', () => {
            expect(titleToSessionName('foo...bar')).toBe('foo_bar')
            expect(titleToSessionName('a//b//c')).toBe('a_b_c')
            expect(titleToSessionName('x: : y')).toBe('x_y')
        })
    })

    describe('issue number prefix', () => {
        it('prepends issue number to session name', () => {
            expect(titleToSessionName('Fix login bug', 42)).toBe('42_fix_login_bug')
            expect(titleToSessionName('Add feature', 123)).toBe('123_add_feature')
        })

        it('handles large issue numbers', () => {
            expect(titleToSessionName('Short', 99999)).toBe('99999_short')
        })

        it('returns just the number when title is empty', () => {
            expect(titleToSessionName('', 42)).toBe('42')
            expect(titleToSessionName('   ', 123)).toBe('123')
        })

        it('returns just the number when title sanitizes to empty', () => {
            expect(titleToSessionName('!!!???', 42)).toBe('42')
        })

        it('accounts for number length when truncating', () => {
            const longTitle = 'This is a very long title that needs truncation'
            const result = titleToSessionName(longTitle, 123)
            expect(result.startsWith('123_')).toBe(true)
            expect(result.length).toBeLessThanOrEqual(40)
        })
    })

    describe('truncation', () => {
        it('truncates long titles at word boundary when possible', () => {
            const longTitle = 'Implement a comprehensive solution for handling complex authentication flows'
            const result = titleToSessionName(longTitle)
            expect(result.length).toBeLessThanOrEqual(40)
            expect(result).toBe('implement_a_comprehensive_solution_for')
        })

        it('truncates at exact limit when no word boundary exists', () => {
            const noWordBoundary = 'abcdefghijklmnopqrstuvwxyzabcdefghijklmnopqrstuvwxyz'
            const result = titleToSessionName(noWordBoundary)
            expect(result.length).toBe(40)
        })

        it('truncates with issue number prefix', () => {
            const longTitle = 'Implement a comprehensive solution for handling complex flows'
            const result = titleToSessionName(longTitle, 12345)
            expect(result.startsWith('12345_')).toBe(true)
            expect(result.length).toBeLessThanOrEqual(40)
        })
    })

    describe('GitHub patterns', () => {
        it('handles GitHub issue title patterns', () => {
            expect(titleToSessionName('[Feature] Add dark mode support', 42))
                .toBe('42_feature_add_dark_mode_support')
            expect(titleToSessionName('Bug: App crashes on save', 123))
                .toBe('123_bug_app_crashes_on_save')
        })

        it('handles PR title patterns', () => {
            expect(titleToSessionName('fix(core): memory leak', 456))
                .toBe('456_fixcore_memory_leak')
            expect(titleToSessionName('chore: update dependencies', 789))
                .toBe('789_chore_update_dependencies')
        })

        it('handles conventional commit prefixes', () => {
            expect(titleToSessionName('feat: add webhooks', 100))
                .toBe('100_feat_add_webhooks')
            expect(titleToSessionName('fix!: breaking change', 200))
                .toBe('200_fix_breaking_change')
        })
    })
})
