import { describe, it, expect } from 'vitest'
import { groupSessionsByVersion } from './sessionVersions'
import { EnrichedSession } from '../types/session'

// Test helper for flattening grouped sessions (extracted from Sidebar.tsx)
function flattenGroupedSessions(sessions: EnrichedSession[]): EnrichedSession[] {
    const sessionGroups = groupSessionsByVersion(sessions)
    const flattenedSessions: EnrichedSession[] = []
    
    for (const group of sessionGroups) {
        for (const version of group.versions) {
            flattenedSessions.push(version.session)
        }
    }
    
    return flattenedSessions
}

describe('Session Flattening for Navigation', () => {
    const createMockSession = (id: string, baseName: string, _versionNum?: number): EnrichedSession => ({
        info: {
            session_id: id,
            display_name: baseName,
            branch: `${baseName}-branch`,
            worktree_path: `/path/${id}`,
            base_branch: 'main',
            status: 'active' as const,
            is_current: false,
            session_type: 'worktree' as const,
            session_state: 'running' as const,
            diff_stats: {
                files_changed: 1,
                additions: 10,
                deletions: 5,
                insertions: 10
            }
        },
        terminals: []
    })

    it('should flatten version groups correctly for navigation', () => {
        const sessions = [
            createMockSession('feature-auth-v1', 'feature-auth', 1),
            createMockSession('feature-auth-v2', 'feature-auth', 2),
            createMockSession('feature-auth-v3', 'feature-auth', 3),
            createMockSession('bug-fix', 'bug-fix'),
            createMockSession('feature-ui-v1', 'feature-ui', 1),
            createMockSession('feature-ui-v2', 'feature-ui', 2)
        ]

        const flattened = flattenGroupedSessions(sessions)

        // The flattened order should maintain the grouped structure
        expect(flattened).toHaveLength(6)
        expect(flattened[0].info.session_id).toBe('feature-auth-v1')
        expect(flattened[1].info.session_id).toBe('feature-auth-v2')
        expect(flattened[2].info.session_id).toBe('feature-auth-v3')
        expect(flattened[3].info.session_id).toBe('bug-fix')
        expect(flattened[4].info.session_id).toBe('feature-ui-v1')
        expect(flattened[5].info.session_id).toBe('feature-ui-v2')
    })

    it('should handle mixed grouped and ungrouped sessions', () => {
        const sessions = [
            createMockSession('standalone-1', 'standalone-1'),
            createMockSession('grouped-v1', 'grouped', 1),
            createMockSession('grouped-v2', 'grouped', 2),
            createMockSession('standalone-2', 'standalone-2'),
            createMockSession('another-v1', 'another', 1),
            createMockSession('another-v2', 'another', 2),
            createMockSession('another-v3', 'another', 3),
            createMockSession('standalone-3', 'standalone-3')
        ]

        const flattened = flattenGroupedSessions(sessions)

        expect(flattened).toHaveLength(8)
        
        // Verify the expected flattened order
        const expectedOrder = [
            'standalone-1',
            'grouped-v1',
            'grouped-v2',
            'standalone-2',
            'another-v1',
            'another-v2',
            'another-v3',
            'standalone-3'
        ]

        expectedOrder.forEach((expectedId, index) => {
            expect(flattened[index].info.session_id).toBe(expectedId)
        })
    })

    it('should handle finding correct indices for navigation', () => {
        const sessions = [
            createMockSession('task-v1', 'task', 1),
            createMockSession('task-v2', 'task', 2),
            createMockSession('task-v3', 'task', 3),
            createMockSession('other', 'other')
        ]

        const flattened = flattenGroupedSessions(sessions)

        // Find index of task-v2
        const v2Index = flattened.findIndex(s => s.info.session_id === 'task-v2')
        expect(v2Index).toBe(1)

        // Navigate to previous (should be task-v1)
        const prevIndex = v2Index - 1
        expect(flattened[prevIndex].info.session_id).toBe('task-v1')

        // Navigate to next (should be task-v3)
        const nextIndex = v2Index + 1
        expect(flattened[nextIndex].info.session_id).toBe('task-v3')

        // Navigate from task-v3 to next (should be other)
        const v3Index = flattened.findIndex(s => s.info.session_id === 'task-v3')
        expect(flattened[v3Index + 1].info.session_id).toBe('other')
    })

    it('should maintain correct order when all sessions are ungrouped', () => {
        const sessions = [
            createMockSession('session-a', 'session-a'),
            createMockSession('session-b', 'session-b'),
            createMockSession('session-c', 'session-c')
        ]

        const flattened = flattenGroupedSessions(sessions)

        expect(flattened).toHaveLength(3)
        expect(flattened[0].info.session_id).toBe('session-a')
        expect(flattened[1].info.session_id).toBe('session-b')
        expect(flattened[2].info.session_id).toBe('session-c')
    })

    it('should handle empty session list', () => {
        const flattened = flattenGroupedSessions([])
        expect(flattened).toHaveLength(0)
    })
})