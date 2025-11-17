import { describe, it, expect } from 'vitest'
import { areSessionInfosEqual, areDiffStatsEqual, areArraysEqual } from './sessionComparison'
import { SessionInfo, SessionState } from '../types/session'

const createBaseSessionInfo = (): SessionInfo => ({
    session_id: 'test-session',
    display_name: 'Test Session',
    branch: 'feature/test',
    worktree_path: '/path/to/worktree',
    base_branch: 'main',
    parent_branch: 'main',
    status: 'active',
    created_at: '2024-01-01T00:00:00Z',
    last_modified: '2024-01-01T00:00:00Z',
    last_modified_ts: 1704067200000,
    has_uncommitted_changes: false,
    has_conflicts: false,
    is_current: false,
    session_type: 'worktree',
    container_status: undefined,
    ready_to_merge: false,
    session_state: SessionState.Running,
    current_task: 'Implement feature',
    todo_percentage: undefined,
    is_blocked: undefined,
    version_group_id: undefined,
    version_number: undefined,
    original_agent_type: 'claude',
    spec_content: undefined,
    diff_stats: {
        files_changed: 5,
        additions: 100,
        deletions: 50,
        insertions: 100,
    },
    top_uncommitted_paths: [],
    merge_conflicting_paths: undefined,
    merge_has_conflicts: undefined,
    merge_is_up_to_date: undefined,
})

describe('sessionComparison', () => {
    describe('areSessionInfosEqual', () => {
        it('should return true for identical objects', () => {
            const session = createBaseSessionInfo()
            expect(areSessionInfosEqual(session, session)).toBe(true)
        })

        it('should return true for objects with same values', () => {
            const session1 = createBaseSessionInfo()
            const session2 = createBaseSessionInfo()
            expect(areSessionInfosEqual(session1, session2)).toBe(true)
        })

        it('should return false when session_id differs', () => {
            const session1 = createBaseSessionInfo()
            const session2 = { ...createBaseSessionInfo(), session_id: 'different-id' }
            expect(areSessionInfosEqual(session1, session2)).toBe(false)
        })

        it('should return false when display_name differs', () => {
            const session1 = createBaseSessionInfo()
            const session2 = { ...createBaseSessionInfo(), display_name: 'Different Name' }
            expect(areSessionInfosEqual(session1, session2)).toBe(false)
        })

        it('should return false when status differs', () => {
            const session1 = createBaseSessionInfo()
            const session2 = { ...createBaseSessionInfo(), status: 'dirty' as const }
            expect(areSessionInfosEqual(session1, session2)).toBe(false)
        })

        it('should return false when diff_stats differs', () => {
            const session1 = createBaseSessionInfo()
            const session2 = {
                ...createBaseSessionInfo(),
                diff_stats: {
                    files_changed: 10,
                    additions: 200,
                    deletions: 100,
                    insertions: 200,
                },
            }
            expect(areSessionInfosEqual(session1, session2)).toBe(false)
        })

        it('should return false when top_uncommitted_paths differs', () => {
            const session1 = { ...createBaseSessionInfo(), top_uncommitted_paths: ['file1.ts'] }
            const session2 = { ...createBaseSessionInfo(), top_uncommitted_paths: ['file2.ts'] }
            expect(areSessionInfosEqual(session1, session2)).toBe(false)
        })

        it('should handle undefined diff_stats', () => {
            const session1 = { ...createBaseSessionInfo(), diff_stats: undefined }
            const session2 = { ...createBaseSessionInfo(), diff_stats: undefined }
            expect(areSessionInfosEqual(session1, session2)).toBe(true)
        })

        it('should return false when one has diff_stats and other does not', () => {
            const session1 = createBaseSessionInfo()
            const session2 = { ...createBaseSessionInfo(), diff_stats: undefined }
            expect(areSessionInfosEqual(session1, session2)).toBe(false)
        })

        it('should handle all SessionInfo properties', () => {
            const session: SessionInfo = {
                session_id: 'test',
                display_name: 'Test',
                branch: 'main',
                worktree_path: '/path',
                base_branch: 'main',
                parent_branch: 'main',
                status: 'active' as const,
                created_at: '2024-01-01T00:00:00Z',
                last_modified: '2024-01-01T00:00:00Z',
                last_modified_ts: 1704067200000,
                has_uncommitted_changes: true,
                has_conflicts: true,
                is_current: true,
                session_type: 'worktree' as const,
                container_status: 'running',
                ready_to_merge: true,
                session_state: SessionState.Running,
                current_task: 'task',
                todo_percentage: 50,
                is_blocked: true,
                version_group_id: 'group1',
                version_number: 2,
                original_agent_type: 'codex',
                spec_content: 'spec',
                diff_stats: { files_changed: 1, additions: 2, deletions: 3, insertions: 4 },
                top_uncommitted_paths: ['a.ts', 'b.ts'],
                merge_conflicting_paths: ['c.ts'],
                merge_has_conflicts: false,
                merge_is_up_to_date: true,
            }
            const session2 = { ...session }
            expect(areSessionInfosEqual(session, session2)).toBe(true)
        })

        it('should detect differences in any property', () => {
            const base = createBaseSessionInfo()

            const propertyTests: Array<[keyof SessionInfo, unknown]> = [
                ['session_id', 'different'],
                ['display_name', 'Different'],
                ['branch', 'other-branch'],
                ['worktree_path', '/other/path'],
                ['base_branch', 'develop'],
                ['parent_branch', 'develop'],
                ['status', 'dirty' as const],
                ['created_at', '2024-02-01T00:00:00Z'],
                ['last_modified', '2024-02-01T00:00:00Z'],
                ['last_modified_ts', 9999999],
                ['has_uncommitted_changes', true],
                ['has_conflicts', true],
                ['is_current', true],
                ['session_type', 'container' as const],
                ['container_status', 'running'],
                ['ready_to_merge', true],
                ['session_state', SessionState.Spec],
                ['current_task', 'Different task'],
                ['todo_percentage', 75],
                ['is_blocked', true],
                ['version_group_id', 'group-id'],
                ['version_number', 5],
                ['original_agent_type', 'gemini'],
                ['spec_content', 'some spec'],
            ]

            for (const [property, value] of propertyTests) {
                const modified = { ...base, [property]: value }
                expect(areSessionInfosEqual(base, modified)).toBe(false)
            }
        })
    })

    describe('areDiffStatsEqual', () => {
        it('should return true for identical diff stats', () => {
            const stats1 = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            const stats2 = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            expect(areDiffStatsEqual(stats1, stats2)).toBe(true)
        })

        it('should return true when both are undefined', () => {
            expect(areDiffStatsEqual(undefined, undefined)).toBe(true)
        })

        it('should return false when one is undefined', () => {
            const stats = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            expect(areDiffStatsEqual(stats, undefined)).toBe(false)
            expect(areDiffStatsEqual(undefined, stats)).toBe(false)
        })

        it('should return false when files_changed differs', () => {
            const stats1 = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            const stats2 = { files_changed: 10, additions: 100, deletions: 50, insertions: 100 }
            expect(areDiffStatsEqual(stats1, stats2)).toBe(false)
        })

        it('should return false when additions differs', () => {
            const stats1 = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            const stats2 = { files_changed: 5, additions: 200, deletions: 50, insertions: 100 }
            expect(areDiffStatsEqual(stats1, stats2)).toBe(false)
        })

        it('should return false when deletions differs', () => {
            const stats1 = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            const stats2 = { files_changed: 5, additions: 100, deletions: 100, insertions: 100 }
            expect(areDiffStatsEqual(stats1, stats2)).toBe(false)
        })

        it('should return false when insertions differs', () => {
            const stats1 = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            const stats2 = { files_changed: 5, additions: 100, deletions: 50, insertions: 200 }
            expect(areDiffStatsEqual(stats1, stats2)).toBe(false)
        })

        it('should return true for same reference', () => {
            const stats = { files_changed: 5, additions: 100, deletions: 50, insertions: 100 }
            expect(areDiffStatsEqual(stats, stats)).toBe(true)
        })
    })

    describe('areArraysEqual', () => {
        it('should return true for identical arrays', () => {
            const arr1 = ['a', 'b', 'c']
            const arr2 = ['a', 'b', 'c']
            expect(areArraysEqual(arr1, arr2)).toBe(true)
        })

        it('should return true for same reference', () => {
            const arr = ['a', 'b', 'c']
            expect(areArraysEqual(arr, arr)).toBe(true)
        })

        it('should return true when both are undefined', () => {
            expect(areArraysEqual(undefined, undefined)).toBe(true)
        })

        it('should return false when one is undefined', () => {
            expect(areArraysEqual(['a'], undefined)).toBe(false)
            expect(areArraysEqual(undefined, ['a'])).toBe(false)
        })

        it('should return false when lengths differ', () => {
            expect(areArraysEqual(['a'], ['a', 'b'])).toBe(false)
        })

        it('should return false when elements differ', () => {
            expect(areArraysEqual(['a', 'b'], ['a', 'c'])).toBe(false)
        })

        it('should return false when order differs', () => {
            expect(areArraysEqual(['a', 'b'], ['b', 'a'])).toBe(false)
        })

        it('should work with empty arrays', () => {
            expect(areArraysEqual([], [])).toBe(true)
        })

        it('should work with number arrays', () => {
            expect(areArraysEqual([1, 2, 3], [1, 2, 3])).toBe(true)
            expect(areArraysEqual([1, 2, 3], [1, 2, 4])).toBe(false)
        })
    })
})
