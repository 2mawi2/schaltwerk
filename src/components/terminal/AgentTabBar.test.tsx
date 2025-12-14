import React from 'react'
import { describe, it, expect, vi } from 'vitest'
import { HeaderActionConfig } from '../../types/actionButton'
import { render, screen, fireEvent } from '@testing-library/react'
import { AgentTabBar } from './AgentTabBar'
import { AgentTab } from '../../store/atoms/agentTabs'
import { AgentType } from '../../types/session'

vi.mock('../UnifiedTab', () => {
    type UnifiedTabProps = {
        label: string
        labelContent?: React.ReactNode
        isActive?: boolean
        onSelect?: () => void
        onClose?: () => void
        onMiddleClick?: () => void
        showCloseButton?: boolean
        className?: string
        style?: React.CSSProperties
        id?: string | number
    }
    const UnifiedTab = ({
        label,
        labelContent,
        isActive,
        onSelect,
        onClose,
    }: UnifiedTabProps) => (
        <div
            data-testid={`unified-tab-${label}`}
            className={isActive ? 'active' : ''}
            onClick={onSelect}
        >
            <span data-testid={`tab-label-${label}`}>{labelContent ?? label}</span>
            {onClose && (
                <button
                    data-testid={`close-${label}`}
                    onClick={(e) => {
                        e.stopPropagation()
                        onClose()
                    }}
                >
                    Close
                </button>
            )}
        </div>
    )
    return { UnifiedTab }
})

vi.mock('../AddTabButton', () => {
    type AddTabButtonProps = {
        onClick?: (e: React.MouseEvent<HTMLButtonElement>) => void
        title?: string
        className?: string
    }
    const AddTabButton = ({ onClick }: AddTabButtonProps) => (
        <button data-testid="add-tab-button" onClick={onClick}>
            +
        </button>
    )
    return { AddTabButton }
})

describe('AgentTabBar', () => {
    const mockTabs: AgentTab[] = [
        { id: 'tab-0', terminalId: 'term-0', label: 'Claude', agentType: 'claude' },
        { id: 'tab-1', terminalId: 'term-1', label: 'Codex', agentType: 'codex' },
    ]

    const defaultProps = {
        tabs: mockTabs,
        activeTab: 0,
        onTabSelect: vi.fn(),
        onTabClose: vi.fn(),
        onTabAdd: vi.fn(),
        onReset: vi.fn(),
        isFocused: true,
        actionButtons: [],
        onAction: vi.fn(),
        shortcutLabel: '⌘T',
    }

    it('renders all tabs using UnifiedTab', () => {
        render(<AgentTabBar {...defaultProps} />)
        expect(screen.getByTestId('unified-tab-Claude')).toBeInTheDocument()
        expect(screen.getByTestId('unified-tab-Codex')).toBeInTheDocument()
    })

    it('highlights the active tab', () => {
        render(<AgentTabBar {...defaultProps} activeTab={1} />)
        expect(screen.getByTestId('unified-tab-Codex').className).toContain('active')
    })

    it('calls onTabSelect when a tab is clicked', () => {
        render(<AgentTabBar {...defaultProps} />)
        fireEvent.click(screen.getByTestId('unified-tab-Codex'))
        expect(defaultProps.onTabSelect).toHaveBeenCalledWith(1)
    })

    it('shows close button only for non-primary tabs', () => {
        render(<AgentTabBar {...defaultProps} />)
        expect(screen.queryByTestId('close-Claude')).not.toBeInTheDocument()
        expect(screen.getByTestId('close-Codex')).toBeInTheDocument()
    })

    it('calls onTabClose when close button is clicked', () => {
        render(<AgentTabBar {...defaultProps} />)
        fireEvent.click(screen.getByTestId('close-Codex'))
        expect(defaultProps.onTabClose).toHaveBeenCalledWith(1)
    })

    it('renders AddTabButton and calls onTabAdd on click', () => {
        render(<AgentTabBar {...defaultProps} />)
        const addButton = screen.getByTestId('add-tab-button')
        fireEvent.click(addButton)
        expect(defaultProps.onTabAdd).toHaveBeenCalled()
    })

    it('renders agent badges per tab', () => {
        render(<AgentTabBar {...defaultProps} />)
        expect(screen.getByTestId('agent-tab-badge-tab-0')).toBeInTheDocument()
        expect(screen.getByTestId('agent-tab-badge-tab-1')).toBeInTheDocument()
        expect(screen.getByTestId('tab-label-Claude').textContent).toContain('Claude')
    })

    it('updates agent badge colors when agent type changes', () => {
        const { rerender } = render(<AgentTabBar {...defaultProps} />)
        const badge = screen.getByTestId('agent-tab-badge-tab-0')
        expect(badge).toHaveTextContent(/Claude/i)

        const updatedTabs: AgentTab[] = [
            { ...mockTabs[0], agentType: 'codex', label: 'codex' },
            mockTabs[1],
        ]
        rerender(<AgentTabBar {...defaultProps} tabs={updatedTabs} />)
        const badgeUpdated = screen.getByTestId('agent-tab-badge-tab-0')
        expect(badgeUpdated).toHaveTextContent(/codex/i)
    })

    it('hides AddTabButton when tab limit is reached', () => {
        const maxTabs: AgentTab[] = [
            ...mockTabs,
            { id: 'tab-2', terminalId: 'term-2', label: 'A3', agentType: 'claude' as AgentType },
            { id: 'tab-3', terminalId: 'term-3', label: 'A4', agentType: 'claude' as AgentType },
            { id: 'tab-4', terminalId: 'term-4', label: 'A5', agentType: 'claude' as AgentType },
            { id: 'tab-5', terminalId: 'term-5', label: 'A6', agentType: 'claude' as AgentType },
        ]
        render(<AgentTabBar {...defaultProps} tabs={maxTabs} />)
        expect(screen.queryByTestId('add-tab-button')).not.toBeInTheDocument()
    })

    it('renders action buttons', () => {
        const actions = [
            { id: 'action1', label: 'Merge', color: 'green', prompt: 'p' },
        ] as HeaderActionConfig[]
        render(<AgentTabBar {...defaultProps} actionButtons={actions} />)
        const actionBtn = screen.getByText('Merge').closest('button')
        expect(actionBtn).toBeInTheDocument()
        fireEvent.click(actionBtn!)
        expect(defaultProps.onAction).toHaveBeenCalledWith(actions[0])
    })

    it('renders shortcut label', () => {
        render(<AgentTabBar {...defaultProps} />)
        expect(screen.getByText('⌘T')).toBeInTheDocument()
    })
})
