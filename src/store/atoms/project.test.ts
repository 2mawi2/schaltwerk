import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import { projectPathAtom } from './project'

describe('project atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('defaults project path to null', () => {
    const projectPath = store.get(projectPathAtom)
    expect(projectPath).toBeNull()
  })

  it('sets project path to provided value', () => {
    store.set(projectPathAtom, '/path/to/project')
    expect(store.get(projectPathAtom)).toBe('/path/to/project')
  })

  it('clears project path when set to null', () => {
    store.set(projectPathAtom, '/path/to/project')
    store.set(projectPathAtom, null)
    expect(store.get(projectPathAtom)).toBeNull()
  })
})
