import React from 'react'
import { describe, it, expect, vi, beforeEach, Mock } from 'vitest'
import { render, waitFor, fireEvent } from '@testing-library/react'
import { ProjectProvider, useProject } from './ProjectContext'
import { ActionButtonsProvider, useActionButtons } from './ActionButtonsContext'
import { getActionButtonColorClasses } from '../constants/actionButtonColors'

const mockInvoke = vi.hoisted(() => vi.fn())

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke
}))

function TestComponent() {
  const { actionButtons, saveActionButtons } = useActionButtons()
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
    </div>
  )
}

function TestWrapper({ children }: { children: React.ReactNode }) {
  // Minimal providers required: Project + ActionButtons
  return (
    <ProjectProvider>
      <ActionButtonsProvider>
        <ProjectInitializer>
          {children}
        </ProjectInitializer>
      </ActionButtonsProvider>
    </ProjectProvider>
  )
}

function ProjectInitializer({ children }: { children: React.ReactNode }) {
  const { setProjectPath } = useProject()
  React.useEffect(() => {
    setProjectPath('/test/project')
  }, [setProjectPath])
  return <>{children}</>
}

describe('Action buttons color updates reflect in UI after save', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('applies updated color after saving', async () => {
    const initial = [
      { id: 'merge-reviewed', label: 'Merge', prompt: 'do merge', color: 'blue' }
    ]
    const updated = [
      { id: 'merge-reviewed', label: 'Merge', prompt: 'do merge', color: 'green' }
    ]

    ;(mockInvoke as Mock)
      // initial load
      .mockResolvedValueOnce(initial)
      // set_project_action_buttons
      .mockResolvedValueOnce(undefined)
      // reload after save
      .mockResolvedValueOnce(updated)

    const { getByTestId, getByText } = render(
      <TestWrapper>
        <TestComponent />
      </TestWrapper>
    )

    // initial classes reflect blue
    await waitFor(() => {
      expect(getByTestId('btn-label')).toHaveTextContent('Merge')
      expect(getByTestId('btn-classes').textContent || '').toContain('text-blue-200')
    })

    // trigger save to green
    fireEvent.click(getByText('save-green'))

    // classes should update to green after reload
    await waitFor(() => {
      expect(getByTestId('btn-classes').textContent || '').toContain('text-green-200')
    })

    // Calls: get -> set -> get
    expect(mockInvoke).toHaveBeenCalledTimes(3)
  })
})

