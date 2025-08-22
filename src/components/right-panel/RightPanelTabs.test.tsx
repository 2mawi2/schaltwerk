import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { RightPanelTabs } from './RightPanelTabs'
import { useSelection } from '../../contexts/SelectionContext'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn(() => Promise.resolve(() => {})),
  emit: vi.fn(),
}))

vi.mock('../../contexts/SelectionContext', () => ({
  useSelection: vi.fn(() => ({
    selection: { kind: 'session', payload: 'test' },
    isDraft: false,
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

vi.mock('../drafts/DraftContentView', () => ({
  DraftContentView: () => <div data-testid="draft-content">Draft Content</div>,
}))

vi.mock('../drafts/DraftListView', () => ({
  DraftListView: () => <div data-testid="draft-list">Draft List</div>,
}))

describe('RightPanelTabs', () => {
  const mockOnFileSelect = vi.fn()
  const mockUseSelection = vi.mocked(useSelection)
  
  beforeEach(() => {
    vi.clearAllMocks()
    // Reset to default mock
    mockUseSelection.mockReturnValue({
      selection: { kind: 'session', payload: 'test' },
      isDraft: false,
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
        isDraft: false,
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
      expect(screen.getByRole('button', { name: /Task/i })).not.toHaveClass('bg-slate-800/50')
      
      // User clicks on Task tab
      fireEvent.click(screen.getByRole('button', { name: /Task/i }))
      
      // Task tab should now be active
      expect(screen.getByRole('button', { name: /Task/i })).toHaveClass('bg-slate-800/50')
      expect(screen.getByRole('button', { name: /Changes/i })).not.toHaveClass('bg-slate-800/50')
      
      // Switch to a different session
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session2' },
        isDraft: false,
        terminals: { top: 'session2-top', bottomBase: 'session2-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Task tab should still be active (user preference persisted)
      expect(screen.getByRole('button', { name: /Task/i })).toHaveClass('bg-slate-800/50')
      expect(screen.getByRole('button', { name: /Changes/i })).not.toHaveClass('bg-slate-800/50')
    })
    
    it('should persist user tab selection when switching to orchestrator', async () => {
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isDraft: false,
        terminals: { top: 'session1-top', bottomBase: 'session1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      const { rerender } = render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // User selects Task tab explicitly
      fireEvent.click(screen.getByRole('button', { name: /Task/i }))
      expect(screen.getByRole('button', { name: /Task/i })).toHaveClass('bg-slate-800/50')
      
      // Switch to orchestrator
      mockUseSelection.mockReturnValue({
        selection: { kind: 'orchestrator' },
        isDraft: false,
        terminals: { top: 'orchestrator-top', bottomBase: 'orchestrator-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // User's choice of Task should persist (shown as "Drafts" in orchestrator)
      expect(screen.getByRole('button', { name: /Drafts/i })).toHaveClass('bg-slate-800/50')
    })
    
    it('should use smart defaults when user has not made a selection', () => {
      // Test orchestrator defaults to Task/Drafts (no Changes tab in orchestrator)
      mockUseSelection.mockReturnValue({
        selection: { kind: 'orchestrator' },
        isDraft: false,
        terminals: { top: 'orchestrator-top', bottomBase: 'orchestrator-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      const { rerender } = render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      expect(screen.getByRole('button', { name: /Drafts/i })).toHaveClass('bg-slate-800/50')
      // Changes tab should not be present in orchestrator
      expect(screen.queryByRole('button', { name: /Changes/i })).not.toBeInTheDocument()
      
      // Test draft session defaults to Task and changes tab is hidden
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'draft1' },
        isDraft: true,
        terminals: { top: 'draft1-top', bottomBase: 'draft1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      expect(screen.getByRole('button', { name: /Task/i })).toHaveClass('bg-slate-800/50')
      // Changes tab should not be present for drafts
      expect(screen.queryByRole('button', { name: /Changes/i })).not.toBeInTheDocument()
      
      // Test running session defaults to Changes
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isDraft: false,
        terminals: { top: 'session1-top', bottomBase: 'session1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      expect(screen.getByRole('button', { name: /Changes/i })).toHaveClass('bg-slate-800/50')
      expect(screen.getByRole('button', { name: /Task/i })).not.toHaveClass('bg-slate-800/50')
    })
    
    it('should allow user to override smart defaults at any time', () => {
      // Start with a running session that has both tabs
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isDraft: false,
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
      
      // User clicks Task
      fireEvent.click(screen.getByRole('button', { name: /Task/i }))
      expect(screen.getByRole('button', { name: /Task/i })).toHaveClass('bg-slate-800/50')
      
      // Switch to another session - Task should stay selected
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session2' },
        isDraft: false,
        terminals: { top: 'session2-top', bottomBase: 'session2-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      expect(screen.getByRole('button', { name: /Task/i })).toHaveClass('bg-slate-800/50')
      
      // User now clicks Changes
      fireEvent.click(screen.getByRole('button', { name: /Changes/i }))
      expect(screen.getByRole('button', { name: /Changes/i })).toHaveClass('bg-slate-800/50')
      
      // Switch to orchestrator - Task tab is shown as "Drafts"
      mockUseSelection.mockReturnValue({
        selection: { kind: 'orchestrator' },
        isDraft: false,
        terminals: { top: 'orchestrator-top', bottomBase: 'orchestrator-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      rerender(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // In orchestrator, the persisted "changes" selection should show diff panel content
      // but only Drafts tab is visible since orchestrator doesn't have changes tab
      expect(screen.getByRole('button', { name: /Drafts/i })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /Changes/i })).not.toBeInTheDocument()
    })
  })
  
  describe('Tab Content Rendering', () => {
    it('should render correct content based on active tab', () => {
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'session1' },
        isDraft: false,
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
      
      // Click Task tab
      fireEvent.click(screen.getByRole('button', { name: /Task/i }))
      
      // Should now show Task content (DraftContentView)
      expect(screen.queryByTestId('diff-panel')).not.toBeInTheDocument()
    })
    
    it('should hide changes tab for draft sessions', () => {
      mockUseSelection.mockReturnValue({
        selection: { kind: 'session', payload: 'draft1' },
        isDraft: true,
        terminals: { top: 'draft1-top', bottomBase: 'draft1-bottom', workingDirectory: '/test' },
        setSelection: vi.fn(),
        clearTerminalTracking: vi.fn(),
        isReady: true
      })
      
      render(
        <RightPanelTabs onFileSelect={mockOnFileSelect} />
      )
      
      // Changes tab should not be visible for drafts
      expect(screen.queryByRole('button', { name: /Changes/i })).not.toBeInTheDocument()
      // Only Task tab should be visible
      expect(screen.getByRole('button', { name: /Task/i })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /Task/i })).toHaveClass('bg-slate-800/50')
    })
  })
})