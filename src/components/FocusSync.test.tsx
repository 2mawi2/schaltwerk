import { useEffect } from 'react'
import { describe, expect, it } from 'vitest'
import { act, render, waitFor } from '@testing-library/react'
import { FocusSync } from './FocusSync'
import { TestProviders } from '../tests/test-utils'
import { useSelection } from '../hooks/useSelection'
import { useFocus } from '../contexts/FocusContext'
import { buildSessionScopeId } from '../common/sessionScope'

let bridge: {
  selection: ReturnType<typeof useSelection>['selection']
  setSelection: ReturnType<typeof useSelection>['setSelection']
  setFocusForSession: ReturnType<typeof useFocus>['setFocusForSession']
  currentFocus: ReturnType<typeof useFocus>['currentFocus']
} | null = null

function ControlBridge() {
  const { selection, setSelection } = useSelection()
  const { setFocusForSession, currentFocus } = useFocus()

  useEffect(() => {
    bridge = {
      selection,
      setSelection,
      setFocusForSession,
      currentFocus,
    }
  }, [selection, setSelection, setFocusForSession, currentFocus])

  return null
}

function nextAnimationFrame() {
  return new Promise<void>((resolve) => {
    requestAnimationFrame(() => resolve())
  })
}

describe('FocusSync', () => {
  it('does not override per-project terminal focus with legacy unscoped keys', async () => {
    render(
      <TestProviders>
        <ControlBridge />
        <FocusSync />
      </TestProviders>
    )

    await waitFor(() => {
      expect(bridge).toBeTruthy()
      expect(bridge?.selection.projectPath).toBe('/test/project')
    })

    await act(async () => {
      await bridge!.setSelection({
        kind: 'session',
        payload: 'alpha',
        worktreePath: '/alpha/path',
        sessionState: 'running',
        projectPath: '/test/project',
      })
    })

    const sessionScopeId = buildSessionScopeId({
      kind: 'session',
      projectPath: '/test/project',
      sessionId: 'alpha',
    })

    act(() => {
      bridge!.setFocusForSession(sessionScopeId, 'terminal')
    })

    await act(async () => {
      await nextAnimationFrame()
      await nextAnimationFrame()
    })

    expect(bridge?.currentFocus).toBe('terminal')
  })
})
