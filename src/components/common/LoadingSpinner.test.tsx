import { render } from '@testing-library/react'
import { LoadingSpinner } from './LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders with default props', () => {
    render(<LoadingSpinner />)

    // Now it uses AnimatedText instead of a spinner, so look for the pre element
    const preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()
    expect(preElement).toHaveAttribute('aria-label', 'SCHALTWERK 3D assembled logo')
  })

  it('renders with custom message', () => {
    const customMessage = 'Custom loading message'
    render(<LoadingSpinner message={customMessage} />)

    // Should still render the animated logo element
    const preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()
    expect(preElement).toHaveAttribute('aria-label', 'SCHALTWERK 3D assembled logo')
  })

  it('renders with different sizes', () => {
    const { rerender } = render(<LoadingSpinner size="sm" />)
    // Just verify the component renders successfully for different sizes
    let preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()

    rerender(<LoadingSpinner size="md" />)
    preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()

    rerender(<LoadingSpinner size="lg" />)
    preElement = document.querySelector('pre')
    expect(preElement).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const customClass = 'custom-spinner-class'
    render(<LoadingSpinner className={customClass} />)

    expect(document.querySelector(`.${customClass}`)).toBeInTheDocument()
  })
})