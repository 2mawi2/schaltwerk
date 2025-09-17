import { render, screen, fireEvent } from '@testing-library/react'
import { describe, expect, test, beforeEach, vi } from 'vitest'
import { BranchAutocomplete } from './BranchAutocomplete'
import { useState } from 'react'

describe('BranchAutocomplete', () => {
    function Wrapper({ initialValue = '' }: { initialValue?: string }) {
        const [value, setValue] = useState(initialValue)
        return (
            <BranchAutocomplete
                value={value}
                onChange={setValue}
                branches={['main', 'develop', 'feature/login-ui', 'fix/bug-123']}
            />
        )
    }

    beforeEach(() => {
        HTMLElement.prototype.scrollIntoView = vi.fn()
    })

    const matchExactText = (text: string) => (_: string, element?: Element | null) => element?.textContent === text

    test('filters suggestions synchronously with input value', () => {
        render(<Wrapper />)

        const input = screen.getByRole('textbox')
        fireEvent.focus(input)
        fireEvent.change(input, { target: { value: 'fix' } })

        // Should immediately render only matching branches without showing stale entries
        expect(screen.getAllByText(matchExactText('fix/bug-123'))[0]).toBeInTheDocument()
        expect(screen.queryByText(matchExactText('main'))).not.toBeInTheDocument()
        expect(screen.queryByText(matchExactText('feature/login-ui'))).not.toBeInTheDocument()
    })
})
