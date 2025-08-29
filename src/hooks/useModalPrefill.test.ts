import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useModalPrefill, processPrefillData, PrefillEventDetail, ModalPrefillHandlers } from './useModalPrefill'

describe('useModalPrefill', () => {
  describe('processPrefillData', () => {
    let handlers: ModalPrefillHandlers

    beforeEach(() => {
      handlers = {
        setName: vi.fn(),
        setTaskContent: vi.fn(),
        setBaseBranch: vi.fn(),
        setWasEdited: vi.fn(),
        setNameLocked: vi.fn(),
        setCreateAsDraft: vi.fn(),
        wasEditedRef: { current: false },
      }
    })

    it('updates name and related state when name is provided', () => {
      const detail: PrefillEventDetail = {
        name: 'test-session',
        lockName: true,
      }

      processPrefillData(detail, handlers)

      expect(handlers.setName).toHaveBeenCalledWith('test-session')
      expect(handlers.setWasEdited).toHaveBeenCalledWith(true)
      expect(handlers.setNameLocked).toHaveBeenCalledWith(true)
      expect(handlers.wasEditedRef.current).toBe(true)
    })

    it('updates agent content when provided', () => {
      const detail: PrefillEventDetail = {
        taskContent: '# Spec content\n\nDescription',
      }

      processPrefillData(detail, handlers)

      expect(handlers.setTaskContent).toHaveBeenCalledWith('# Spec content\n\nDescription')
    })

    it('updates base branch when provided', () => {
      const detail: PrefillEventDetail = {
        baseBranch: 'main',
      }

      processPrefillData(detail, handlers)

      expect(handlers.setBaseBranch).toHaveBeenCalledWith('main')
    })

    it('sets createAsDraft to false when fromDraft is true', () => {
      const detail: PrefillEventDetail = {
        fromDraft: true,
      }

      processPrefillData(detail, handlers)

      expect(handlers.setCreateAsDraft).toHaveBeenCalledWith(false)
    })

    it('handles lockName being false', () => {
      const detail: PrefillEventDetail = {
        name: 'test-session',
        lockName: false,
      }

      processPrefillData(detail, handlers)

      expect(handlers.setNameLocked).toHaveBeenCalledWith(false)
    })

    it('does not update name when not provided', () => {
      const detail: PrefillEventDetail = {
        taskContent: 'Content only',
      }

      processPrefillData(detail, handlers)

      expect(handlers.setName).not.toHaveBeenCalled()
      expect(handlers.setWasEdited).not.toHaveBeenCalled()
      expect(handlers.setNameLocked).not.toHaveBeenCalled()
      expect(handlers.wasEditedRef.current).toBe(false)
    })

    it('does not update agent content when not provided', () => {
      const detail: PrefillEventDetail = {
        name: 'test-session',
      }

      processPrefillData(detail, handlers)

      expect(handlers.setTaskContent).not.toHaveBeenCalled()
    })

    it('handles all fields being provided', () => {
      const detail: PrefillEventDetail = {
        name: 'full-session',
        taskContent: 'Full content',
        baseBranch: 'develop',
        lockName: true,
        fromDraft: true,
      }

      processPrefillData(detail, handlers)

      expect(handlers.setName).toHaveBeenCalledWith('full-session')
      expect(handlers.setTaskContent).toHaveBeenCalledWith('Full content')
      expect(handlers.setBaseBranch).toHaveBeenCalledWith('develop')
      expect(handlers.setWasEdited).toHaveBeenCalledWith(true)
      expect(handlers.setNameLocked).toHaveBeenCalledWith(true)
      expect(handlers.setCreateAsDraft).toHaveBeenCalledWith(false)
      expect(handlers.wasEditedRef.current).toBe(true)
    })

    it('handles empty detail object', () => {
      const detail: PrefillEventDetail = {}

      processPrefillData(detail, handlers)

      expect(handlers.setName).not.toHaveBeenCalled()
      expect(handlers.setTaskContent).not.toHaveBeenCalled()
      expect(handlers.setBaseBranch).not.toHaveBeenCalled()
      expect(handlers.setWasEdited).not.toHaveBeenCalled()
      expect(handlers.setNameLocked).not.toHaveBeenCalled()
      expect(handlers.setCreateAsDraft).not.toHaveBeenCalled()
      expect(handlers.wasEditedRef.current).toBe(false)
    })
  })

  describe('useModalPrefill hook', () => {
    let handlers: ModalPrefillHandlers

    beforeEach(() => {
      handlers = {
        setName: vi.fn(),
        setTaskContent: vi.fn(),
        setBaseBranch: vi.fn(),
        setWasEdited: vi.fn(),
        setNameLocked: vi.fn(),
        setCreateAsDraft: vi.fn(),
        wasEditedRef: { current: false },
      }
    })

    it('registers event listener on mount', () => {
      const addEventListenerSpy = vi.spyOn(window, 'addEventListener')

      const { unmount } = renderHook(() => useModalPrefill(handlers))

      expect(addEventListenerSpy).toHaveBeenCalledWith(
        'schaltwerk:new-session:prefill',
        expect.any(Function)
      )

      unmount()
      addEventListenerSpy.mockRestore()
    })

    it('removes event listener on unmount', () => {
      const removeEventListenerSpy = vi.spyOn(window, 'removeEventListener')

      const { unmount } = renderHook(() => useModalPrefill(handlers))

      unmount()

      expect(removeEventListenerSpy).toHaveBeenCalledWith(
        'schaltwerk:new-session:prefill',
        expect.any(Function)
      )

      removeEventListenerSpy.mockRestore()
    })

    it('handles prefill event when dispatched', () => {
      renderHook(() => useModalPrefill(handlers))

      const detail: PrefillEventDetail = {
        name: 'event-session',
        taskContent: 'Event content',
        baseBranch: 'main',
        lockName: true,
        fromDraft: true,
      }

      const event = new CustomEvent('schaltwerk:new-session:prefill', { detail })
      window.dispatchEvent(event)

      expect(handlers.setName).toHaveBeenCalledWith('event-session')
      expect(handlers.setTaskContent).toHaveBeenCalledWith('Event content')
      expect(handlers.setBaseBranch).toHaveBeenCalledWith('main')
      expect(handlers.setWasEdited).toHaveBeenCalledWith(true)
      expect(handlers.setNameLocked).toHaveBeenCalledWith(true)
      expect(handlers.setCreateAsDraft).toHaveBeenCalledWith(false)
      expect(handlers.wasEditedRef.current).toBe(true)
    })

    it('handles event with empty detail', () => {
      renderHook(() => useModalPrefill(handlers))

      const event = new CustomEvent('schaltwerk:new-session:prefill', { detail: {} })
      window.dispatchEvent(event)

      expect(handlers.setName).not.toHaveBeenCalled()
      expect(handlers.setTaskContent).not.toHaveBeenCalled()
      expect(handlers.setBaseBranch).not.toHaveBeenCalled()
      expect(handlers.setCreateAsDraft).not.toHaveBeenCalled()
    })

    it('handles event with no detail', () => {
      renderHook(() => useModalPrefill(handlers))

      const event = new CustomEvent('schaltwerk:new-session:prefill')
      window.dispatchEvent(event)

      // Should not throw and should handle gracefully
      expect(handlers.setName).not.toHaveBeenCalled()
    })
  })
})