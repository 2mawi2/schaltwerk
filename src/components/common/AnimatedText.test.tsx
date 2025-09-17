import { render, screen } from '@testing-library/react'
import { AnimatedText } from './AnimatedText'

describe('AnimatedText', () => {
  it('applies the shared muted theme color by default', () => {
    render(<AnimatedText text="loading" />)

    const logo = screen.getByRole('img', { name: 'SCHALTWERK 3D assembled logo' })
    expect(logo).toHaveClass('text-text-muted')
  })
})
