import React from 'react'
import { TauriCommands } from '../common/tauriCommands'
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { ActionButtonsProvider, useActionButtons } from './ActionButtonsContext'
import { Provider, useSetAtom } from 'jotai'
import { createStore } from 'jotai'
import { projectPathAtom } from '../store/atoms/project'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke
}))

function TestComponent({ initialPath }: { initialPath?: string }) {
  const { actionButtons, loading } = useActionButtons()
  const setProjectPath = useSetAtom(projectPathAtom)

  React.useEffect(() => {
    if (initialPath) {
      setProjectPath(initialPath)
    }
  }, [initialPath, setProjectPath])

  return (
    <div>
      <div data-testid="loading">{loading.toString()}</div>
      <div data-testid="buttons-count">{actionButtons.length}</div>
      <div data-testid="first-button-label">{actionButtons[0]?.label || ''}</div>
    </div>
  )
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  const store = React.useMemo(() => createStore(), [])
  return (
    <Provider store={store}>
      <ActionButtonsProvider>
        {children}
      </ActionButtonsProvider>
    </Provider>
  )
}

describe('ActionButtonsContext', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('loads action buttons when project path is provided', async () => {
    const mockButtons = [
      { id: 'test', label: 'Test', prompt: 'test prompt', color: 'blue' }
    ]
    ;(mockInvoke as Mock).mockResolvedValue(mockButtons)

    const { getByTestId } = render(
      <TestWrapper>
        <TestComponent initialPath="/test/project" />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(getByTestId('loading')).toHaveTextContent('false')
    })

    expect(mockInvoke).toHaveBeenCalledWith(TauriCommands.GetProjectActionButtons)
    expect(getByTestId('buttons-count')).toHaveTextContent('1')
    expect(getByTestId('first-button-label')).toHaveTextContent('Test')
  })

  it('does not load action buttons when no project path', async () => {
    const { getByTestId } = render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(getByTestId('loading')).toHaveTextContent('false')
    })

    expect(mockInvoke).not.toHaveBeenCalled()
    expect(getByTestId('buttons-count')).toHaveTextContent('0')
  })

  it('reloads action buttons when project changes', async () => {
    const projectAButtons = [
      { id: 'project-a', label: 'Project A', prompt: 'project a prompt', color: 'blue' }
    ]
    const projectBButtons = [
      { id: 'project-b', label: 'Project B', prompt: 'project b prompt', color: 'green' }
    ]

    ;(mockInvoke as Mock)
      .mockResolvedValueOnce(projectAButtons)
      .mockResolvedValueOnce(projectBButtons)

    const { getByTestId, rerender } = render(
      <TestWrapper>
        <TestComponent initialPath="/test/project-a" />
      </TestWrapper>
    )

    // Wait for initial load
    await waitFor(() => {
      expect(getByTestId('loading')).toHaveTextContent('false')
    })
    
    expect(getByTestId('first-button-label')).toHaveTextContent('Project A')

    // Switch project by re-rendering with different path
    rerender(
      <TestWrapper>
        <TestComponent initialPath="/test/project-b" />
      </TestWrapper>
    )

    await waitFor(() => {
      expect(getByTestId('first-button-label')).toHaveTextContent('Project B')
    })

    expect(mockInvoke).toHaveBeenCalledTimes(2)
  })
})
