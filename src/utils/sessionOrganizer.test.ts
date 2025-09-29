import { describe, it, expect } from 'vitest'
import { SessionState } from '../types/session'
import {
    organizeSessionsByColumn,
    getSessionColumn,
    findSessionPosition,
    type Session
} from './sessionOrganizer'

const createSession = (
    overrides: Partial<Session['info']> & { session_id: string }
): Session => ({
    info: {
        session_state: SessionState.Running,
        ready_to_merge: false,
        status: 'active',
        ...overrides
    }
})

describe('sessionOrganizer', () => {
    describe('organizeSessionsByColumn', () => {
        it('should return empty columns for empty input', () => {
            const result = organizeSessionsByColumn([])
            expect(result[0]).toEqual([])
            expect(result[1]).toEqual([])
            expect(result[2]).toEqual([])
        })

        it('should place spec sessions in column 0', () => {
            const sessions: Session[] = [
                createSession({ session_id: 'spec1', session_state: SessionState.Spec, status: 'spec' }),
                createSession({ session_id: 'spec2', session_state: SessionState.Spec, status: 'spec' })
            ]
            const result = organizeSessionsByColumn(sessions)
            expect(result[0]).toHaveLength(2)
            expect(result[1]).toHaveLength(0)
            expect(result[2]).toHaveLength(0)
            expect(result[0][0].info.session_id).toBe('spec1')
            expect(result[0][1].info.session_id).toBe('spec2')
        })

        it('should place running sessions without ready_to_merge in column 1', () => {
            const sessions: Session[] = [
                createSession({ session_id: 'run1' }),
                createSession({ session_id: 'run2' })
            ]
            const result = organizeSessionsByColumn(sessions)
            expect(result[0]).toHaveLength(0)
            expect(result[1]).toHaveLength(2)
            expect(result[2]).toHaveLength(0)
            expect(result[1][0].info.session_id).toBe('run1')
            expect(result[1][1].info.session_id).toBe('run2')
        })

        it('should place ready_to_merge sessions in column 2', () => {
            const sessions: Session[] = [
                createSession({ session_id: 'ready1', ready_to_merge: true }),
                createSession({
                    session_id: 'ready2',
                    session_state: SessionState.Reviewed,
                    ready_to_merge: true
                })
            ]
            const result = organizeSessionsByColumn(sessions)
            expect(result[0]).toHaveLength(0)
            expect(result[1]).toHaveLength(0)
            expect(result[2]).toHaveLength(2)
            expect(result[2][0].info.session_id).toBe('ready1')
            expect(result[2][1].info.session_id).toBe('ready2')
        })

        it('should correctly distribute mixed sessions', () => {
            const sessions: Session[] = [
                createSession({ session_id: 'spec1', session_state: SessionState.Spec, status: 'spec' }),
                createSession({ session_id: 'run1' }),
                createSession({ session_id: 'ready1', ready_to_merge: true }),
                createSession({ session_id: 'spec2', session_state: SessionState.Spec, status: 'spec' }),
                createSession({ session_id: 'run2' }),
                createSession({
                    session_id: 'ready2',
                    session_state: SessionState.Reviewed,
                    ready_to_merge: true
                })
            ]
            const result = organizeSessionsByColumn(sessions)
            expect(result[0]).toHaveLength(2) // specs
            expect(result[1]).toHaveLength(2) // running
            expect(result[2]).toHaveLength(2) // ready
        })
    })

    describe('getSessionColumn', () => {
        it('should return 0 for spec sessions', () => {
            const session = createSession({ session_id: 'spec1', session_state: SessionState.Spec, status: 'spec' })
            expect(getSessionColumn(session)).toBe(0)
        })

        it('should return 1 for running sessions without ready_to_merge', () => {
            const session1 = createSession({ session_id: 'run1' })
            const session2 = createSession({ session_id: 'run2' })
            expect(getSessionColumn(session1)).toBe(1)
            expect(getSessionColumn(session2)).toBe(1)
        })

        it('should return 2 for ready_to_merge sessions', () => {
            const session = createSession({ session_id: 'ready1', ready_to_merge: true })
            expect(getSessionColumn(session)).toBe(2)
        })
    })

    describe('findSessionPosition', () => {
        const sessions: Session[] = [
            createSession({ session_id: 'spec1', session_state: SessionState.Spec, status: 'spec' }),
            createSession({ session_id: 'spec2', session_state: SessionState.Spec, status: 'spec' }),
            createSession({ session_id: 'run1' }),
            createSession({ session_id: 'ready1', ready_to_merge: true })
        ]
        const columns = organizeSessionsByColumn(sessions)

        it('should find spec session in column 0', () => {
            const position = findSessionPosition('spec1', columns)
            expect(position).toEqual({ column: 0, row: 0 })
            
            const position2 = findSessionPosition('spec2', columns)
            expect(position2).toEqual({ column: 0, row: 1 })
        })

        it('should find running session in column 1', () => {
            const position = findSessionPosition('run1', columns)
            expect(position).toEqual({ column: 1, row: 0 })
        })

        it('should find ready session in column 2', () => {
            const position = findSessionPosition('ready1', columns)
            expect(position).toEqual({ column: 2, row: 0 })
        })

        it('should return null for non-existent session', () => {
            const position = findSessionPosition('nonexistent', columns)
            expect(position).toBeNull()
        })

        it('should handle empty columns', () => {
            const emptyColumns: [Session[], Session[], Session[]] = [[], [], []]
            const position = findSessionPosition('any', emptyColumns)
            expect(position).toBeNull()
        })
    })
})