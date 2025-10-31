import React, { useEffect, useMemo } from 'react'
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { Provider, createStore, useSetAtom } from 'jotai'
import { projectPathAtom } from '../../store/atoms/project'
import { useActionButtons } from '../useActionButtons'
import { TauriCommands } from '../../common/tauriCommands'
import { getActionButtonColorClasses } from '../../constants/actionButtonColors'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke
}))

function TestComponent() {
  const { actionButtons, saveActionButtons, resetToDefaults } = useActionButtons()
  const first = actionButtons[0]
  const classes = first ? getActionButtonColorClasses(first.color) : ''

  return (
    <div>
      <div data-testid="btn-label">{first?.label || ''}</div>
      <div data-testid="btn-classes">{classes}</div>
      <button
        onClick={() => {
          if (!first) return
          const updated = [{ ...first, color: 'green' }]
          void saveActionButtons(updated)
        }}
      >save-green</button>
      <button
        onClick={() => {
          void resetToDefaults()
        }}
      >reset-defaults</button>
    </div>
  )
}

function ProjectInitializer({ children }: { children: React.ReactNode }) {
  const setProjectPath = useSetAtom(projectPathAtom)
  useEffect(() => {
    setProjectPath('/test/project')
  }, [setProjectPath])
  return <>{children}</>
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  const store = useMemo(() => createStore(), [])
  return (
    <Provider store={store}>
      <ProjectInitializer>
        {children}
      </ProjectInitializer>
    </Provider>
  )
}

describe('useActionButtons color updates', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies updated color after saving', async () => {
    const initial = [
      { id: 'squash-merge-main', label: 'Squash Merge Main', prompt: 'do merge', color: 'blue' }
    ]
    const updated = [
      { id: 'squash-merge-main', label: 'Squash Merge Main', prompt: 'do merge', color: 'green' }
    ]

    const getResponses = [initial, updated]

    ;(mockInvoke as Mock).mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case TauriCommands.GetProjectActionButtons: {
          const response = getResponses.shift()
          if (!response) throw new Error('No mock response available for GetProjectActionButtons')
          return Promise.resolve(response)
        }
        case TauriCommands.SetProjectActionButtons: {
          expect(args).toEqual({ actions: updated })
          return Promise.resolve(undefined)
        }
        default:
          throw new Error(`Unexpected command invoked: ${command}`)
      }
    })

    const { getByTestId, getByText } = render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(getByTestId('btn-label')).toHaveTextContent('Squash Merge Main')
      expect(getByTestId('btn-classes').textContent || '').toContain('text-blue-200')
    })

    fireEvent.click(getByText('save-green'))

    await waitFor(() => {
      expect(getByTestId('btn-classes').textContent || '').toContain('text-green-200')
    })

    expect(mockInvoke).toHaveBeenCalledTimes(3)
  })

  it('resetToDefaults seeds Squash Merge Main default action via backend', async () => {
    const backendDefaults = [
      {
        id: 'squash-merge-main',
        label: 'Squash Merge Main',
        prompt: 'Task: Squash-merge all reviewed Schaltwerk sessions',
        color: 'green'
      }
    ]

    const getResponses = [[], backendDefaults]

    ;(mockInvoke as Mock).mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case TauriCommands.GetProjectActionButtons: {
          const response = getResponses.shift()
          if (response === undefined) throw new Error('No mock response available for GetProjectActionButtons')
          return Promise.resolve(response)
        }
        case TauriCommands.ResetProjectActionButtonsToDefaults: {
          expect(args).toBeUndefined()
          return Promise.resolve(backendDefaults)
        }
        default:
          throw new Error(`Unexpected command invoked: ${command}`)
      }
    })

    const { getByText } = render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    )

    fireEvent.click(getByText('reset-defaults'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.ResetProjectActionButtonsToDefaults)
    })
  })

  it('resetToDefaults retries load for the active project after a failed fetch', async () => {
    const backendDefaults = [
      {
        id: 'squash-merge-main',
        label: 'Squash Merge Main',
        prompt: 'Task: Squash-merge all reviewed Schaltwerk sessions',
        color: 'green'
      }
    ]

    let getCalls = 0

    ;(mockInvoke as Mock).mockImplementation((command: string, args?: unknown) => {
      switch (command) {
        case TauriCommands.GetProjectActionButtons: {
          getCalls += 1
          if (getCalls === 1) {
            return Promise.reject(new Error('backend unavailable'))
          }
          return Promise.resolve(backendDefaults)
        }
        case TauriCommands.ResetProjectActionButtonsToDefaults: {
          expect(args).toBeUndefined()
          return Promise.resolve(backendDefaults)
        }
        default:
          throw new Error(`Unexpected command invoked: ${command}`)
      }
    })

    const { getByText, getByTestId } = render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenCalledTimes(1)
      expect(mockInvoke).toHaveBeenLastCalledWith(TauriCommands.GetProjectActionButtons)
    })

    fireEvent.click(getByText('reset-defaults'))

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenNthCalledWith(2, TauriCommands.ResetProjectActionButtonsToDefaults)
    })

    await waitFor(() => {
      expect(mockInvoke).toHaveBeenNthCalledWith(3, TauriCommands.GetProjectActionButtons)
      expect(getByTestId('btn-label')).toHaveTextContent('Squash Merge Main')
    })
  })
})
