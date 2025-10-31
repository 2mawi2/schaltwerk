import { describe, it, expect, beforeEach } from 'vitest'
import { createStore } from 'jotai'
import {
  actionButtonsListAtom,
  registerActionButtonAtom,
  unregisterActionButtonAtom,
  updateActionButtonColorAtom,
} from './actionButtons'
import type { HeaderActionConfig } from '../../types/actionButton'

describe('actionButtons atoms', () => {
  let store: ReturnType<typeof createStore>

  beforeEach(() => {
    store = createStore()
  })

  it('exposes an empty list by default', () => {
    const buttons = store.get(actionButtonsListAtom)
    expect(buttons).toEqual([])
  })

  it('registers and unregisters action buttons', () => {
    const first: HeaderActionConfig = {
      id: 'squash-merge-main',
      label: 'Squash Merge Main',
      prompt: 'Task: Squash-merge all reviewed sessions',
      color: 'green',
    }
    const second: HeaderActionConfig = {
      id: 'run-tests',
      label: 'Run Tests',
      prompt: 'bun run test',
      color: 'violet',
    }

    store.set(registerActionButtonAtom, first)
    store.set(registerActionButtonAtom, second)

    expect(store.get(actionButtonsListAtom)).toEqual([first, second])

    store.set(unregisterActionButtonAtom, first.id)

    expect(store.get(actionButtonsListAtom)).toEqual([second])
  })

  it('updates action button colors immutably', () => {
    const action: HeaderActionConfig = {
      id: 'squash-merge-main',
      label: 'Squash Merge Main',
      prompt: 'Task: Squash-merge all reviewed sessions',
      color: 'green',
    }

    store.set(registerActionButtonAtom, action)
    store.set(updateActionButtonColorAtom, { id: action.id, color: 'blue' })

    const [updated] = store.get(actionButtonsListAtom)
    expect(updated?.color).toBe('blue')
    expect(updated).not.toBe(action)
  })
})
