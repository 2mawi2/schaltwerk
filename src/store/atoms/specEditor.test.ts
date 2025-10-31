import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createStore } from 'jotai'
import {
  SPEC_EDITOR_VIEW_MODE_STORAGE_KEY,
  SpecEditorViewMode,
  markSpecEditorSessionSavedAtom,
  specEditorContentAtomFamily,
  specEditorDirtyAtomFamily,
  specEditorDirtySessionsAtom,
  specEditorSavedContentAtomFamily,
  specEditorViewModeAtomFamily,
} from './specEditor'
import { logger } from '../../utils/logger'

describe('specEditor atoms', () => {
  const sessionId = 'session-123'
  let store = createStore()

  beforeEach(() => {
    sessionStorage.clear()
    store = createStore()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('manages spec content state per session', () => {
    expect(store.get(specEditorContentAtomFamily(sessionId))).toBe('')

    store.set(specEditorContentAtomFamily(sessionId), '# Initial spec')

    expect(store.get(specEditorContentAtomFamily(sessionId))).toBe('# Initial spec')

    // Updating another session does not affect the first one
    const otherSession = 'session-456'
    store.set(specEditorContentAtomFamily(otherSession), '# Different')

    expect(store.get(specEditorContentAtomFamily(sessionId))).toBe('# Initial spec')
    expect(store.get(specEditorContentAtomFamily(otherSession))).toBe('# Different')
  })

  it('tracks dirty state when content differs from last saved value', () => {
    store.set(specEditorSavedContentAtomFamily(sessionId), 'clean content')

    expect(store.get(specEditorDirtyAtomFamily(sessionId))).toBe(false)

    store.set(specEditorContentAtomFamily(sessionId), 'modified content')

    expect(store.get(specEditorDirtyAtomFamily(sessionId))).toBe(true)
    expect(store.get(specEditorDirtySessionsAtom)).toEqual([sessionId])

    store.set(specEditorContentAtomFamily(sessionId), 'clean content')

    expect(store.get(specEditorDirtyAtomFamily(sessionId))).toBe(false)
    expect(store.get(specEditorDirtySessionsAtom)).toEqual([])
  })

  it('marks session clean after save action', () => {
    store.set(specEditorContentAtomFamily(sessionId), 'pending save')

    expect(store.get(specEditorDirtyAtomFamily(sessionId))).toBe(true)

    store.set(markSpecEditorSessionSavedAtom, sessionId)

    expect(store.get(specEditorDirtyAtomFamily(sessionId))).toBe(false)
    expect(store.get(specEditorSavedContentAtomFamily(sessionId))).toBe('pending save')
  })

  it('persists view mode changes and enforces valid values', () => {
    expect(store.get(specEditorViewModeAtomFamily(sessionId))).toBe<SpecEditorViewMode>('preview')
    expect(sessionStorage.getItem(SPEC_EDITOR_VIEW_MODE_STORAGE_KEY)).toBeNull()

    store.set(specEditorViewModeAtomFamily(sessionId), 'edit')

    expect(store.get(specEditorViewModeAtomFamily(sessionId))).toBe<SpecEditorViewMode>('edit')
    const saved = sessionStorage.getItem(SPEC_EDITOR_VIEW_MODE_STORAGE_KEY)
    expect(saved).not.toBeNull()
    expect(saved && JSON.parse(saved)).toEqual([[sessionId, 'edit']])

    const warnSpy = vi.spyOn(logger, 'warn').mockImplementation(() => {})
    store.set(specEditorViewModeAtomFamily(sessionId), 'invalid' as unknown as SpecEditorViewMode)

    expect(warnSpy).toHaveBeenCalledWith('[specEditorAtoms] Ignoring invalid view mode', 'invalid')
    expect(store.get(specEditorViewModeAtomFamily(sessionId))).toBe<SpecEditorViewMode>('edit')
  })
})
