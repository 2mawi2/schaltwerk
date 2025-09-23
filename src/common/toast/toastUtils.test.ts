import { describe, it, expect, vi, beforeEach } from 'vitest'
import { makeId, calculateToastOverflow } from './toastUtils'

describe('toastUtils', () => {
  describe('makeId', () => {
    beforeEach(() => {
      // Reset crypto mock
      vi.restoreAllMocks()
    })

    it('uses crypto.randomUUID when available', () => {
      const mockRandomUUID = vi.fn().mockReturnValue('uuid-123')
      Object.defineProperty(global, 'crypto', {
        value: { randomUUID: mockRandomUUID },
        writable: true
      })

      const result = makeId()
      expect(result).toBe('uuid-123')
      expect(mockRandomUUID).toHaveBeenCalled()
    })

    it('falls back to Math.random when crypto is not available', () => {
      // Mock Math.random for consistent results
      const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.123456789)
      Object.defineProperty(global, 'crypto', {
        value: undefined,
        writable: true
      })

      const result = makeId()
      expect(result).toMatch(/^toast-[a-z0-9]+$/)
      expect(result.startsWith('toast-')).toBe(true)
      expect(result.length).toBeGreaterThan(6) // 'toast-' + at least 1 char
      expect(mockRandom).toHaveBeenCalled()

      mockRandom.mockRestore()
    })

    it('falls back to Math.random when randomUUID is not available', () => {
      const mockRandom = vi.spyOn(Math, 'random').mockReturnValue(0.987654321)
      Object.defineProperty(global, 'crypto', {
        value: {},
        writable: true
      })

      const result = makeId()
      expect(result).toMatch(/^toast-[a-z0-9]{8}$/)
      expect(result.startsWith('toast-')).toBe(true)
      expect(result.length).toBe(14) // 'toast-' + 8 chars
      expect(mockRandom).toHaveBeenCalled()

      mockRandom.mockRestore()
    })
  })

   describe('calculateToastOverflow', () => {
     it('returns all toasts when under limit', () => {
       const toasts = [
         { id: '1', tone: 'success' as const, title: 'Test 1' },
         { id: '2', tone: 'warning' as const, title: 'Test 2' }
       ]
       const result = calculateToastOverflow(toasts, 3)
       expect(result.toasts).toEqual(toasts)
       expect(result.removedIds).toEqual([])
     })

     it('removes oldest toasts when over limit', () => {
       const toasts = [
         { id: '1', tone: 'success' as const, title: 'Test 1' },
         { id: '2', tone: 'warning' as const, title: 'Test 2' },
         { id: '3', tone: 'error' as const, title: 'Test 3' },
         { id: '4', tone: 'success' as const, title: 'Test 4' }
       ]
       const result = calculateToastOverflow(toasts, 2)
       expect(result.toasts).toEqual([
         { id: '3', tone: 'error' as const, title: 'Test 3' },
         { id: '4', tone: 'success' as const, title: 'Test 4' }
       ])
       expect(result.removedIds).toEqual(['1', '2'])
     })

     it('handles exact limit', () => {
       const toasts = [
         { id: '1', tone: 'success' as const, title: 'Test 1' },
         { id: '2', tone: 'warning' as const, title: 'Test 2' }
       ]
       const result = calculateToastOverflow(toasts, 2)
       expect(result.toasts).toEqual(toasts)
       expect(result.removedIds).toEqual([])
     })

     it('handles empty array', () => {
       const toasts: Array<{ id: string; tone: 'success' | 'warning' | 'error'; title: string; description?: string; durationMs?: number }> = []
       const result = calculateToastOverflow(toasts, 3)
       expect(result.toasts).toEqual([])
       expect(result.removedIds).toEqual([])
     })

     it('handles zero maxToasts', () => {
       const toasts = [
         { id: '1', tone: 'success' as const, title: 'Test 1' },
         { id: '2', tone: 'warning' as const, title: 'Test 2' }
       ]
       const result = calculateToastOverflow(toasts, 0)
       expect(result.toasts).toEqual([])
       expect(result.removedIds).toEqual(['1', '2'])
     })
  })
})