import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { Tab } from './Tab'

describe('Tab', () => {
  const mockProps = {
    projectPath: '/Users/test/project',
    projectName: 'project',
    isActive: false,
    onSelect: vi.fn(),
    onClose: vi.fn()
  }

  it('renders project name', () => {
    render(<Tab {...mockProps} />)
    expect(screen.getByText('project')).toBeInTheDocument()
  })

  it('shows full path in tooltip', () => {
    render(<Tab {...mockProps} />)
    const button = screen.getByTitle('/Users/test/project')
    expect(button).toBeInTheDocument()
  })

  it('applies active styles when active', () => {
    render(<Tab {...mockProps} isActive={true} />)
    const button = screen.getByTitle('/Users/test/project')
    expect(button.className).toContain('text-blue-200')
  })

  it('applies inactive styles when not active', () => {
    render(<Tab {...mockProps} isActive={false} />)
    const button = screen.getByTitle('/Users/test/project')
    expect(button.className).toContain('text-slate-400')
  })

  it('calls onSelect when clicked', () => {
    const onSelect = vi.fn()
    render(<Tab {...mockProps} onSelect={onSelect} />)
    const button = screen.getByTitle('/Users/test/project')
    fireEvent.click(button)
    expect(onSelect).toHaveBeenCalledTimes(1)
  })

  it('calls onClose when close button clicked', () => {
    const onClose = vi.fn()
    const onSelect = vi.fn()
    render(<Tab {...mockProps} onClose={onClose} onSelect={onSelect} />)
    const closeButton = screen.getByTitle('Close project')
    fireEvent.click(closeButton)
    expect(onClose).toHaveBeenCalledTimes(1)
    expect(onSelect).not.toHaveBeenCalled()
  })

  it('truncates long project names', () => {
    const longName = 'very-long-project-name-that-should-be-truncated'
    render(<Tab {...mockProps} projectName={longName} />)
    const nameSpan = screen.getByText(longName)
    expect(nameSpan.className).toContain('truncate')
    expect(nameSpan.className).toContain('flex-1')
  })
})