import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { TabBar, ProjectTab } from './TabBar'

describe('TabBar', () => {
  const mockTabs: ProjectTab[] = [
    { projectPath: '/Users/test/project1', projectName: 'project1' },
    { projectPath: '/Users/test/project2', projectName: 'project2' },
    { projectPath: '/Users/test/project3', projectName: 'project3' }
  ]

  const mockProps = {
    tabs: mockTabs,
    activeTabPath: '/Users/test/project1',
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn()
  }

  it('renders all tabs', () => {
    render(<TabBar {...mockProps} />)
    expect(screen.getByText('project1')).toBeInTheDocument()
    expect(screen.getByText('project2')).toBeInTheDocument()
    expect(screen.getByText('project3')).toBeInTheDocument()
  })

  it('returns null when no tabs', () => {
    const { container } = render(<TabBar {...mockProps} tabs={[]} />)
    expect(container.firstChild).toBeNull()
  })

  it('marks correct tab as active', () => {
    render(<TabBar {...mockProps} activeTabPath="/Users/test/project2" />)

    const tabs = screen.getAllByTitle(/\/Users\/test\/project/)

    expect(tabs[0].className).toContain('text-slate-300')
    expect(tabs[1].className).toContain('text-white')
    expect(tabs[2].className).toContain('text-slate-300')
  })

  it('calls onSelectTab with correct path when tab clicked', () => {
    const onSelectTab = vi.fn()
    render(<TabBar {...mockProps} onSelectTab={onSelectTab} />)
    
    const tabs = screen.getAllByTitle(/\/Users\/test\/project/)
    fireEvent.click(tabs[1])
    
    expect(onSelectTab).toHaveBeenCalledWith('/Users/test/project2')
  })

  it('calls onCloseTab with correct path when close button clicked', () => {
    const onCloseTab = vi.fn()
    render(<TabBar {...mockProps} onCloseTab={onCloseTab} />)
    
    const closeButton = screen.getByTitle('Close project2')
    fireEvent.click(closeButton)
    
    expect(onCloseTab).toHaveBeenCalledWith('/Users/test/project2')
  })

  it('renders tabs in provided order', () => {
    render(<TabBar {...mockProps} />)
    
    const tabs = screen.getAllByTitle(/\/Users\/test\/project/)
    
    expect(tabs[0].title).toBe('/Users/test/project1')
    expect(tabs[1].title).toBe('/Users/test/project2')
    expect(tabs[2].title).toBe('/Users/test/project3')
  })

  it('handles no active tab gracefully', () => {
    render(<TabBar {...mockProps} activeTabPath={null} />)
    
    const tabs = screen.getAllByTitle(/\/Users\/test\/project/)
    
    tabs.forEach(tab => {
      expect(tab.className).toContain('text-slate-300')
    })
  })

})