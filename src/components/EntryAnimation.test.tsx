import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { EntryAnimation } from './EntryAnimation'

describe('EntryAnimation', () => {
  it('renders children immediately when not loading', () => {
    render(
      <EntryAnimation>
        <div>Ready Content</div>
      </EntryAnimation>
    )

    const contentWrapper = screen.getByTestId('entry-animation-content')
    expect(contentWrapper).not.toHaveClass('opacity-0')
    expect(screen.queryByLabelText('SCHALTWERK 3D assembled logo')).toBeNull()
    expect(screen.getByText('Ready Content')).toBeVisible()
  })
})
