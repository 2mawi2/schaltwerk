import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'

import { ONBOARDING_STEPS } from './steps'

describe('onboarding steps', () => {
    it('includes guidance for opening worktrees via the open button', () => {
        const openStep = ONBOARDING_STEPS.find((step) => step.title === 'Open Your Worktree')

        expect(openStep, 'expected an onboarding step dedicated to opening worktrees').toBeDefined()
        expect(openStep?.highlight).toBe('[data-testid="topbar-open-button"]')

        render(<>{openStep?.content}</>)
        expect(screen.getByText(/select the session/i)).toBeInTheDocument()
        const matches = screen.getAllByText((_, element) => element?.textContent?.toLowerCase().includes('click open') ?? false)
        expect(matches.length).toBeGreaterThan(0)
    })
})
