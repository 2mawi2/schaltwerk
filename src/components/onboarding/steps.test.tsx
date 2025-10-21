import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ONBOARDING_STEPS } from './steps'

describe('onboarding steps', () => {
    it('guides users to pick the correct base branch before launching an agent', () => {
        const branchStep = ONBOARDING_STEPS.find((step) => step.title === 'Launch from the Right Branch')

        expect(branchStep, 'expected an onboarding step that highlights base branch selection').toBeDefined()
        expect(branchStep?.highlight).toBe('[data-onboarding="start-agent-button"]')

        render(<>{branchStep?.content}</>)
        expect(screen.getByText(/start agent/i)).toBeInTheDocument()
        expect(screen.getByText(/main/i)).toBeInTheDocument()
    })

    it('explains how to review diffs and leave comments', () => {
        const diffStep = ONBOARDING_STEPS.find((step) => step.title === 'Review Diffs and Comment')

        expect(diffStep, 'expected an onboarding step for diff review guidance').toBeDefined()
        expect(diffStep?.highlight).toBe('[data-testid="diff-panel"]')

        render(<>{diffStep?.content}</>)
        expect(screen.getAllByText(/comment/i).length).toBeGreaterThan(0)
        expect(screen.getByText(/⌘G/i)).toBeInTheDocument()
    })

    it('shows how to open a worktree in external tools', () => {
        const openStep = ONBOARDING_STEPS.find((step) => step.title === 'Open the Worktree Externally')

        expect(openStep, 'expected a tutorial step describing the Open button').toBeDefined()
        expect(openStep?.highlight).toBe('[data-onboarding="open-worktree-button"]')

        render(<>{openStep?.content}</>)
        expect(screen.getByText(/open button/i)).toBeInTheDocument()
        expect(screen.getByText(/arrow next to the button/i)).toBeInTheDocument()
    })

    it('covers the merge versus pull request decision after review', () => {
        const mergeStep = ONBOARDING_STEPS.find((step) => step.title === 'Merge or Open a PR')

        expect(mergeStep, 'expected an onboarding step describing merge and PR options').toBeDefined()
        expect(mergeStep?.highlight).toBe('[data-onboarding="session-actions"]')

        render(<>{mergeStep?.content}</>)
        expect(screen.getAllByText(/pull request/i).length).toBeGreaterThan(0)
        expect(screen.getAllByText(/merge/i).length).toBeGreaterThan(0)
    })
})
