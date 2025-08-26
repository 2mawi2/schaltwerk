import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RightPanelTabs } from './RightPanelTabs'
import { useSelection } from '../../contexts/SelectionContext'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(() => Promise.resolve([null, null])),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}))

vi.mock('../../contexts/SelectionContext', () => ({
  useSelection: vi.fn(() => ({
    selection: { kind: 'session', payload: 'test' },
    isPlan: false,
  })),
}))

vi.mock('../../contexts/ProjectContext', () => ({
  useProject: vi.fn(() => ({
    projectPath: '/test/project',
    projectName: 'test-project',
  })),
}))

vi.mock('../diff/SimpleDiffPanel', () => ({
  SimpleDiffPanel: () => <div data-testid="diff-panel">Diff Panel</div>,
}))

vi.mock('../plans/PlanContentView', async () => {
  const React = await import('react')
  return {
    PlanContentView: () => React.createElement('div', { 'data-testid': 'plan-content' }, 'Plan Content'),
  }
})

vi.mock('../plans/PlanListView', async () => {
  const React = await import('react')
  return {
    PlanListView: () => React.createElement('div', { 'data-testid': 'plan-list' }, 'Plan List'),
  }
})

vi.mock('../plans/PlanInfoPanel', async () => {
  const React = await import('react')
  return {
    PlanInfoPanel: () => React.createElement('div', { 'data-testid': 'plan-info' }, 'Plan Info'),
  }
})

describe('RightPanelTabs', () => {
  const mockOnFileSelect = vi.fn()
  const mockUseSelection = vi.mocked(useSelection)
  
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default mock
    mockUseSelection.mockReturnValue({
      selection: { kind: 'session', payload: 'test' },
      isPlan: false,
      terminals: { top: 'test-top', bottomBase: 'test-bottom', workingDirectory: '/test' },
      setSelection: vi.fn(),
      clearTerminalTracking: vi.fn(),
      isReady: true
    })
  })

  describe('Tab Persistence', () => {
    it('should persist user tab selection when switching between sessions', async () => {
      // Start with a running session (defaults to Changes)
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isPlan: false,
        terminals: { top: 'session1-top', bottomBase: 'session1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      const { rerender } = render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Initially shows Changes tab for running session
      expect(screen.getByRole('button', { name: /Changes/i })).toHaveClass('bg-slate-800/50')
      expect(screen.getByTitle('Plan')).not.toHaveClass('bg-slate-800/50')
      
      // User clicks on Plan tab
      fireEvent.click(screen.getByTitle('Plan'))
      
      // Plan tab should now be active
      expect(screen.getByTitle('Plan')).toHaveClass('bg-slate-800/50')
      expect(screen.getByRole('button', { name: /Changes/i })).not.toHaveClass('bg-slate-800/50')
      
      // Switch to a different session
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session2' },
        isPlan: false,
        terminals: { top: 'session2-top', bottomBase: 'session2-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Plan tab should still be active (user preference persisted)
      expect(screen.getByTitle('Plan')).toHaveClass('bg-slate-800/50')
      expect(screen.getByRole('button', { name: /Changes/i })).not.toHaveClass('bg-slate-800/50')
    })
    
    it('should persist user tab selection when switching to commander', async () => {
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isPlan: false,
        terminals: { top: 'session1-top', bottomBase: 'session1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      const { rerender } = render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // User selects Plan tab explicitly
      fireEvent.click(screen.getByTitle('Plan'))
      expect(screen.getByTitle('Plan')).toHaveClass('bg-slate-800/50')
      
      // Switch to commander
      mockUseSelection.mockReturnValue({
        selection: { kind: 'commander' },
        isPlan: false,
        terminals: { top: 'commander-top', bottomBase: 'commander-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // User's choice of Plan should persist (shown as "Plans" in commander)
      expect(screen.getByRole('button', { name: /Plans/i })).toHaveClass('bg-slate-800/50')
    })
    
    it('should use smart defaults when user has not made a selection', () => {
      // Test commander defaults to Plan/Plans (no Changes tab in commander)
      mockUseSelection.mockReturnValue({
        selection: { kind: 'commander' },
        isPlan: false,
        terminals: { top: 'commander-top', bottomBase: 'commander-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      const { rerender } = render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      expect(screen.getByRole('button', { name: /Plans/i })).toHaveClass('bg-slate-800/50')
      // Changes tab should be present in commander
      expect(screen.queryByRole('button', { name: /Changes/i })).toBeInTheDocument()
      
      // Test plan session defaults to Plan and changes tab is hidden
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'draft1' },
        isPlan: true,
        terminals: { top: 'draft1-top', bottomBase: 'draft1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Get the tab button specifically (has title="Plan")
      const taskTab = screen.getByTitle('Plan')
      expect(taskTab).toHaveClass('bg-slate-800/50')
      // Changes tab should not be present for plans
      expect(screen.queryByRole('button', { name: /Changes/i })).not.toBeInTheDocument()
      
      // Test running session defaults to Changes
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isPlan: false,
        terminals: { top: 'session1-top', bottomBase: 'session1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      expect(screen.getByRole('button', { name: /Changes/i })).toHaveClass('bg-slate-800/50')
      expect(screen.getByTitle('Plan')).not.toHaveClass('bg-slate-800/50')
    })
    
    it('should allow user to override smart defaults at any time', () => {
      // Start with a running session that has both tabs
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isPlan: false,
        terminals: { top: 'session1-top', bottomBase: 'session1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      const { rerender } = render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Session starts with Changes (default)
      expect(screen.getByRole('button', { name: /Changes/i })).toHaveClass('bg-slate-800/50')
      
      // User clicks Plan
      fireEvent.click(screen.getByTitle('Plan'))
      expect(screen.getByTitle('Plan')).toHaveClass('bg-slate-800/50')
      
      // Switch to another session - Plan should stay selected
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session2' },
        isPlan: false,
        terminals: { top: 'session2-top', bottomBase: 'session2-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      expect(screen.getByTitle('Plan')).toHaveClass('bg-slate-800/50')
      
      // User now clicks Changes
      fireEvent.click(screen.getByRole('button', { name: /Changes/i }))
      expect(screen.getByRole('button', { name: /Changes/i })).toHaveClass('bg-slate-800/50')
      
      // Switch to commander - Plan tab is shown as "Plans"
      mockUseSelection.mockReturnValue({
        selection: { kind: 'commander' },
        isPlan: false,
        terminals: { top: 'commander-top', bottomBase: 'commander-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // In commander, both Changes and Plans tabs should be visible
      expect(screen.getByRole('button', { name: /Plans/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Changes/i })).toBeInTheDocument()
    })
  })
  
  describe('Tab Content Rendering', () => {
    it('should render correct content based on active tab', () => {
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isPlan: false,
        terminals: { top: 'session1-top', bottomBase: 'session1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Initially shows Changes content (SimpleDiffPanel)
      expect(screen.getByTestId('diff-panel')).toBeInTheDocument()
      
      // Click Plan tab
      fireEvent.click(screen.getByTitle('Plan'))
      
      // Should now show Plan content (DraftContentView)
      expect(screen.queryByTestId('diff-panel')).not.toBeInTheDocument()
    })
    
    it('should hide changes tab for plan sessions', () => {
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'draft1' },
        isPlan: true,
        terminals: { top: 'draft1-top', bottomBase: 'draft1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Changes tab should not be visible for plans
      expect(screen.queryByRole('button', { name: /Changes/i })).not.toBeInTheDocument()
      // Only Plan tab should be visible
      expect(screen.getByTitle('Plan')).toBeInTheDocument()
      expect(screen.getByTitle('Plan')).toHaveClass('bg-slate-800/50')
    })
  })
})