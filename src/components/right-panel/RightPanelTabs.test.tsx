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

vi.mock('../../contexts/FocusContext', () => ({
  useFocus: vi.fn(() => ({
    setFocusForSession: vi.fn(),
    currentFocus: null,
  })),
}))

vi.mock('../diff/SimpleDiffPanel', () => ({
  SimpleDiffPanel: () => <div data-testid="diff-panel">Diff Panel</div>,
}))

vi.mock('../plans/PlanContentView', async () => {
  const React = await import('react')
  return {
    PlanContentView: () => React.createElement('div', { 'data-testid': 'spec-content' }, 'Spec Content'),
  }
})

vi.mock('../plans/PlanListView', async () => {
  const React = await import('react')
  return {
    PlanListView: () => React.createElement('div', { 'data-testid': 'spec-list' }, 'Spec List'),
  }
})

vi.mock('../plans/PlanInfoPanel', async () => {
  const React = await import('react')
  return {
    PlanInfoPanel: () => React.createElement('div', { 'data-testid': 'spec-info' }, 'Spec Info'),
  }
})

vi.mock('../plans/PlanMetadataPanel', async () => {
  const React = await import('react')
  return {
    PlanMetadataPanel: () => React.createElement('div', { 'data-testid': 'spec-metadata' }, 'Spec Metadata'),
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
      expect(screen.getByTitle('Spec')).not.toHaveClass('bg-slate-800/50')
      
      // User clicks on Spec tab
      fireEvent.click(screen.getByTitle('Spec'))
      
      // Spec tab should now be active (with focus styling)
      expect(screen.getByTitle('Spec')).toHaveClass('bg-blue-800/30')
      expect(screen.getByRole('button', { name: /Changes/i })).not.toHaveClass('bg-blue-800/30')
      
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
      
      // Spec tab should still be active (user preference persisted)
      // Note: still has focus styling from the click
      expect(screen.getByTitle('Spec')).toHaveClass('bg-blue-800/30')
      expect(screen.getByRole('button', { name: /Changes/i })).not.toHaveClass('bg-blue-800/30')
    })
    
    it('should persist user tab selection when switching to orchestrator', async () => {
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
      
      // User selects Spec tab explicitly
      fireEvent.click(screen.getByTitle('Spec'))
      expect(screen.getByTitle('Spec')).toHaveClass('bg-blue-800/30')
      
      // Switch to orchestrator
      mockUseSelection.mockReturnValue({
        selection: { kind: 'orchestrator' },
        isPlan: false,
        terminals: { top: 'orchestrator-top', bottomBase: 'orchestrator-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // In orchestrator, only Changes tab is shown (no Specs tab anymore)
      expect(screen.getByRole('button', { name: /Changes/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Specs/i })).not.toBeInTheDocument()
    })
    
    it('should use smart defaults when user has not made a selection', () => {
      // Test orchestrator only shows Changes tab (Specs accessed via Spec Mode)
      mockUseSelection.mockReturnValue({
        selection: { kind: 'orchestrator' },
        isPlan: false,
        terminals: { top: 'orchestrator-top', bottomBase: 'orchestrator-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      const { rerender } = render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // In orchestrator, only Changes tab is shown
      expect(screen.getByRole('button', { name: /Changes/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Specs/i })).not.toBeInTheDocument()
      
      // Test spec session defaults to Spec and changes tab is hidden
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
      
      // Get the tab button specifically (has title="Spec Info")
      const taskTab = screen.getByTitle('Spec Info')
      expect(taskTab).toHaveClass('bg-slate-800/50')
      // Changes tab should not be present for specs
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
      expect(screen.getByTitle('Spec')).not.toHaveClass('bg-slate-800/50')
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
      
      // User clicks Spec
      fireEvent.click(screen.getByTitle('Spec'))
      expect(screen.getByTitle('Spec')).toHaveClass('bg-blue-800/30')
      
      // Switch to another session - Spec should stay selected
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
      
      // Since the panel still has focus from the previous click, the Spec tab shows focus styling
      expect(screen.getByTitle('Spec')).toHaveClass('bg-blue-800/30')
      
      // User now clicks Changes
      fireEvent.click(screen.getByRole('button', { name: /Changes/i }))
      // Changes tab is now active (with focus styling since we clicked)
      expect(screen.getByRole('button', { name: /Changes/i })).toHaveClass('bg-blue-800/30')
      
      // Switch to orchestrator - only Changes tab is shown
      mockUseSelection.mockReturnValue({
        selection: { kind: 'orchestrator' },
        isPlan: false,
        terminals: { top: 'orchestrator-top', bottomBase: 'orchestrator-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // In orchestrator, only Changes tab is shown (Specs accessed via Spec Mode)
      expect(screen.getByRole('button', { name: /Changes/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Specs/i })).not.toBeInTheDocument()
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
      
      // Click Spec tab
      fireEvent.click(screen.getByTitle('Spec'))
      
      // Should now show Spec content (DraftContentView)
      expect(screen.queryByTestId('diff-panel')).not.toBeInTheDocument()
    })
    
    it('should hide changes tab for spec sessions', () => {
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
      
      // Changes tab should not be visible for specs
      expect(screen.queryByRole('button', { name: /Changes/i })).not.toBeInTheDocument()
      // Only Info tab should be visible for specs
      expect(screen.getByTitle('Spec Info')).toBeInTheDocument()
      expect(screen.getByTitle('Spec Info')).toHaveClass('bg-slate-800/50')
    })
  })
})