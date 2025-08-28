import { render, screen } from '@testing-library/react'
import { LoadingSpinner } from './LoadingSpinner'

describe('LoadingSpinner', () => {
  it('renders with default props', () => {
    render(<LoadingSpinner />)

    expect(screen.getByText('Loading...')).toBeInTheDocument()
    const spinner = document.querySelector('.animate-spin')
    expect(spinner).toBeInTheDocument()
  })

  it('renders with custom message', () => {
    const customMessage = 'Custom loading message'
    render(<LoadingSpinner message={customMessage} />)

    expect(screen.getByText(customMessage)).toBeInTheDocument()
  })

  it('renders with different sizes', () => {
    const { rerender } = render(<LoadingSpinner size="sm" />)
    expect(document.querySelector('.w-4')).toBeInTheDocument()

    rerender(<LoadingSpinner size="md" />)
    expect(document.querySelector('.w-8')).toBeInTheDocument()

    rerender(<LoadingSpinner size="lg" />)
    expect(document.querySelector('.w-12')).toBeInTheDocument()
  })

  it('applies custom className', () => {
    const customClass = 'custom-spinner-class'
    render(<LoadingSpinner className={customClass} />)

    expect(document.querySelector(`.${customClass}`)).toBeInTheDocument()
  })
})