import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { PrSessionModal, PrPreviewResponse } from './PrSessionModal'
import { ModalProvider } from '../../contexts/ModalContext'

// Mock ModalProvider
const MockModalProvider = ({ children }: { children: React.ReactNode }) => (
    <ModalProvider>{children}</ModalProvider>
)

describe('PrSessionModal', () => {
    const mockOnClose = vi.fn()
    const mockOnConfirm = vi.fn()
    const mockOnToggleAutoCancel = vi.fn()

    const defaultPreview: PrPreviewResponse = {
        sessionName: 'test-session',
        sessionBranch: 'session-branch',
        parentBranch: 'main',
        defaultTitle: 'Test PR',
        defaultBody: 'Test Body',
        commitCount: 3,
        commitSummaries: ['feat: one', 'fix: two', 'docs: three'],
        defaultBranch: 'main',
        worktreePath: '/tmp/worktree',
        hasUncommittedChanges: false,
        branchPushed: false,
    }

    beforeEach(() => {
        vi.clearAllMocks()
    })

    it('renders correctly when open', () => {
        render(
            <MockModalProvider>
                <PrSessionModal
                    open={true}
                    sessionName="test-session"
                    status="ready"
                    preview={defaultPreview}
                    onClose={mockOnClose}
                    onConfirm={mockOnConfirm}
                    autoCancelEnabled={false}
                    onToggleAutoCancel={mockOnToggleAutoCancel}
                />
            </MockModalProvider>
        )

        expect(screen.getByText('Create Pull Request')).toBeDefined()
        expect(screen.getByDisplayValue('Test PR')).toBeDefined()
        expect(screen.getByDisplayValue('Test Body')).toBeDefined()
        expect(screen.getByDisplayValue('main')).toBeDefined() // Base branch
        expect(screen.getByText(/All changes will be squashed/)).toBeDefined() // Default is squash
    })

    it('toggles strategy mode', () => {
        render(
            <MockModalProvider>
                <PrSessionModal
                    open={true}
                    sessionName="test-session"
                    status="ready"
                    preview={defaultPreview}
                    onClose={mockOnClose}
                    onConfirm={mockOnConfirm}
                    autoCancelEnabled={false}
                    onToggleAutoCancel={mockOnToggleAutoCancel}
                />
            </MockModalProvider>
        )

        // Default should be reapply
        const squashButton = screen.getByText('Squash changes')
        const reapplyButton = screen.getByText('Use existing commits')

        // Verify reapply description is visible
        expect(screen.getAllByText(/existing commits/).length).toBeGreaterThan(0)

        // Click Squash
        fireEvent.click(squashButton)
        expect(screen.getAllByText(/single commit/).length).toBeGreaterThan(0)

        // Click Reapply again
        fireEvent.click(reapplyButton)
        expect(screen.getAllByText(/existing commits/).length).toBeGreaterThan(0)
    })

    it('calls onConfirm with correct options', () => {
        render(
            <MockModalProvider>
                <PrSessionModal
                    open={true}
                    sessionName="test-session"
                    status="ready"
                    preview={defaultPreview}
                    onClose={mockOnClose}
                    onConfirm={mockOnConfirm}
                    autoCancelEnabled={false}
                    onToggleAutoCancel={mockOnToggleAutoCancel}
                />
            </MockModalProvider>
        )

        const confirmButton = screen.getByText('Create PR').closest('button')
        if (!confirmButton) throw new Error('Confirm button not found')
        
        // Default (squash)
        fireEvent.click(confirmButton)
        expect(mockOnConfirm).toHaveBeenLastCalledWith({
            title: 'Test PR',
            body: 'Test Body',
            baseBranch: 'main',
            prBranchName: undefined,
            mode: 'squash',
            commitMessage: undefined,
        })

        // Toggle to reapply
        const reapplyButton = screen.getByText('Use existing commits')
        fireEvent.click(reapplyButton)
        fireEvent.click(confirmButton)
        expect(mockOnConfirm).toHaveBeenLastCalledWith({
            title: 'Test PR',
            body: 'Test Body',
            baseBranch: 'main',
            prBranchName: undefined,
            mode: 'reapply',
            commitMessage: undefined,
        })
    })

    it('respects prefill suggestions', () => {
        render(
            <MockModalProvider>
                <PrSessionModal
                    open={true}
                    sessionName="test-session"
                    status="ready"
                    preview={defaultPreview}
                    prefill={{
                        suggestedTitle: 'Suggested Title',
                        suggestedMode: 'squash',
                        suggestedBaseBranch: 'develop',
                    }}
                    onClose={mockOnClose}
                    onConfirm={mockOnConfirm}
                    autoCancelEnabled={false}
                    onToggleAutoCancel={mockOnToggleAutoCancel}
                />
            </MockModalProvider>
        )

        expect(screen.getByDisplayValue('Suggested Title')).toBeDefined()
        expect(screen.getByDisplayValue('develop')).toBeDefined()
        expect(screen.getAllByText(/single commit/).length).toBeGreaterThan(0)
    })

    describe('branch conflict validation', () => {
        it('blocks submission when branch has conflict warning', () => {
            const previewWithConflict: PrPreviewResponse = {
                ...defaultPreview,
                branchConflictWarning: '[rejected] Branch already exists with different commits',
            }

            render(
                <MockModalProvider>
                    <PrSessionModal
                        open={true}
                        sessionName="test-session"
                        status="ready"
                        preview={previewWithConflict}
                        onClose={mockOnClose}
                        onConfirm={mockOnConfirm}
                        autoCancelEnabled={false}
                        onToggleAutoCancel={mockOnToggleAutoCancel}
                    />
                </MockModalProvider>
            )

            expect(screen.getByText('Branch conflict detected')).toBeDefined()
            const confirmButton = screen.getByText('Create PR').closest('button')
            expect(confirmButton).toHaveProperty('disabled', true)

            fireEvent.click(confirmButton!)
            expect(mockOnConfirm).not.toHaveBeenCalled()
        })

        it('blocks squash mode when branch is pushed', () => {
            const previewPushed: PrPreviewResponse = {
                ...defaultPreview,
                branchPushed: true,
            }

            render(
                <MockModalProvider>
                    <PrSessionModal
                        open={true}
                        sessionName="test-session"
                        status="ready"
                        preview={previewPushed}
                        onClose={mockOnClose}
                        onConfirm={mockOnConfirm}
                        autoCancelEnabled={false}
                        onToggleAutoCancel={mockOnToggleAutoCancel}
                    />
                </MockModalProvider>
            )

            expect(screen.getByText('Cannot squash pushed branch')).toBeDefined()
            const confirmButton = screen.getByText('Create PR').closest('button')
            expect(confirmButton).toHaveProperty('disabled', true)
        })

        it('allows reapply mode when branch is pushed without uncommitted changes', () => {
            const previewPushed: PrPreviewResponse = {
                ...defaultPreview,
                branchPushed: true,
                hasUncommittedChanges: false,
            }

            render(
                <MockModalProvider>
                    <PrSessionModal
                        open={true}
                        sessionName="test-session"
                        status="ready"
                        preview={previewPushed}
                        onClose={mockOnClose}
                        onConfirm={mockOnConfirm}
                        autoCancelEnabled={false}
                        onToggleAutoCancel={mockOnToggleAutoCancel}
                    />
                </MockModalProvider>
            )

            const reapplyButton = screen.getByText('Use existing commits')
            fireEvent.click(reapplyButton)

            const confirmButton = screen.getByText('Create PR').closest('button')
            expect(confirmButton).toHaveProperty('disabled', false)

            fireEvent.click(confirmButton!)
            expect(mockOnConfirm).toHaveBeenCalledWith(expect.objectContaining({
                mode: 'reapply',
            }))
        })

        it('blocks submission when branch is pushed with uncommitted changes', () => {
            const previewPushedUncommitted: PrPreviewResponse = {
                ...defaultPreview,
                branchPushed: true,
                hasUncommittedChanges: true,
            }

            render(
                <MockModalProvider>
                    <PrSessionModal
                        open={true}
                        sessionName="test-session"
                        status="ready"
                        preview={previewPushedUncommitted}
                        onClose={mockOnClose}
                        onConfirm={mockOnConfirm}
                        autoCancelEnabled={false}
                        onToggleAutoCancel={mockOnToggleAutoCancel}
                    />
                </MockModalProvider>
            )

            const reapplyButton = screen.getByText('Use existing commits')
            fireEvent.click(reapplyButton)

            expect(screen.getByText('Uncommitted changes conflict with pushed branch')).toBeDefined()
            const confirmButton = screen.getByText('Create PR').closest('button')
            expect(confirmButton).toHaveProperty('disabled', true)
        })

        it('bypasses all validations when custom branch name is used', () => {
            const previewWithAllIssues: PrPreviewResponse = {
                ...defaultPreview,
                branchPushed: true,
                hasUncommittedChanges: true,
                branchConflictWarning: '[rejected] Branch conflict',
            }

            render(
                <MockModalProvider>
                    <PrSessionModal
                        open={true}
                        sessionName="test-session"
                        status="ready"
                        preview={previewWithAllIssues}
                        onClose={mockOnClose}
                        onConfirm={mockOnConfirm}
                        autoCancelEnabled={false}
                        onToggleAutoCancel={mockOnToggleAutoCancel}
                    />
                </MockModalProvider>
            )

            const customBranchCheckbox = screen.getByLabelText('Use custom PR branch name')
            fireEvent.click(customBranchCheckbox)

            expect(screen.queryByText('Branch conflict detected')).toBeNull()
            expect(screen.queryByText('Cannot squash pushed branch')).toBeNull()

            const confirmButton = screen.getByText('Create PR').closest('button')
            expect(confirmButton).toHaveProperty('disabled', false)

            fireEvent.click(confirmButton!)
            expect(mockOnConfirm).toHaveBeenCalled()
        })
    })
})
