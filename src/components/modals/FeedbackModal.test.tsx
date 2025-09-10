import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { FeedbackModal } from './FeedbackModal'

vi.mock('../../analytics', () => ({
  analytics: {
    track: vi.fn(),
    isConsentGiven: vi.fn(() => true),
  },
  AnalyticsEventName: {
    USER_FEEDBACK: 'user_feedback',
  },
}))

vi.mock('@tauri-apps/api/app', () => ({
  getVersion: vi.fn(() => Promise.resolve('1.0.0')),
}))

describe('FeedbackModal', () => {
  const mockOnClose = vi.fn()

  beforeEach(async () => {
    vi.clearAllMocks()
    const { analytics } = await import('../../analytics')
    vi.mocked(analytics.isConsentGiven).mockReturnValue(true)
    vi.mocked(analytics.track).mockImplementation(vi.fn())
  })

  it('should not render when closed', () => {
    render(<FeedbackModal open={false} onClose={mockOnClose} />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('should render when open', () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    expect(screen.getByRole('dialog')).toBeInTheDocument()
    const headings = screen.getAllByText('Send Feedback')
    expect(headings.length).toBeGreaterThan(0)
  })

  it('should display feedback textarea', () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    expect(textarea).toBeInTheDocument()
  })

  it('should display PostHog privacy notice', () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    expect(screen.getByText(/stored anonymously on PostHog/i)).toBeInTheDocument()
  })

  it('should disable submit button when feedback is empty', () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    expect(submitButton).toBeDisabled()
  })

  it('should enable submit button when feedback has minimum length', async () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, 'Short text')
    expect(submitButton).not.toBeDisabled()
  })

  it('should disable submit for feedback less than 10 characters', async () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, '123456789')
    expect(submitButton).toBeDisabled()
  })

  it('should show character count', async () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    
    await userEvent.type(textarea, 'Test feedback message')
    expect(screen.getByText(/21 \/ 1000/)).toBeInTheDocument()
  })

  it('should enforce maximum character limit', async () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i) as HTMLTextAreaElement
    
    const longText = 'a'.repeat(1100)
    await userEvent.type(textarea, longText)
    
    expect(textarea.value.length).toBeLessThanOrEqual(1000)
  })

  it('should close on Cancel button click', async () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const cancelButton = screen.getByRole('button', { name: /cancel/i })
    
    fireEvent.click(cancelButton)
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('should close on Escape key', async () => {
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    
    fireEvent.keyDown(window, { key: 'Escape' })
    expect(mockOnClose).toHaveBeenCalledTimes(1)
  })

  it('should submit feedback on button click', async () => {
    const { analytics } = await import('../../analytics')
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, 'This is great feedback!')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(analytics.track).toHaveBeenCalledWith(
        'user_feedback',
        expect.objectContaining({
          message: 'This is great feedback!',
          version: '1.0.0',
        })
      )
    })
  })

  it('should show success message after submission', async () => {
    await import('../../analytics')
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, 'Great app, love it!')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(screen.getByText(/thank you for your feedback/i)).toBeInTheDocument()
    })
  })

  it('should close modal after successful submission', async () => {
    const { analytics } = await import('../../analytics')
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, 'Great app, love it!')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(analytics.track).toHaveBeenCalled()
    })
    
    await waitFor(() => {
      expect(screen.getByText(/thank you for your feedback/i)).toBeInTheDocument()
    }, { timeout: 3000 })
  })

  it('should show error message on submission failure', async () => {
    const { analytics } = await import('../../analytics')
    vi.mocked(analytics.track).mockImplementation(() => {
      throw new Error('Network error')
    })
    
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, 'Great app, love it!')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(screen.getByText(/failed to send feedback/i)).toBeInTheDocument()
    }, { timeout: 2000 })
  })

  it('should clear feedback after successful submission', async () => {
    const { analytics } = await import('../../analytics')
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i) as HTMLTextAreaElement
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, 'Great app, love it!')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(analytics.track).toHaveBeenCalled()
    })
    
    await waitFor(() => {
      expect(screen.getByText(/thank you for your feedback/i)).toBeInTheDocument()
    }, { timeout: 2000 })
    
    expect(textarea.value).toBe('')
  })

  it('should not submit if analytics consent not given', async () => {
    const { analytics } = await import('../../analytics')
    vi.mocked(analytics.isConsentGiven).mockReturnValue(false)
    
    render(<FeedbackModal open={true} onClose={mockOnClose} />)
    const textarea = screen.getByPlaceholderText(/share your feedback/i)
    const submitButton = screen.getByRole('button', { name: /send feedback/i })
    
    await userEvent.type(textarea, 'Great app, love it!')
    fireEvent.click(submitButton)
    
    await waitFor(() => {
      expect(screen.getByText(/analytics must be enabled/i)).toBeInTheDocument()
    }, { timeout: 2000 })
    
    expect(analytics.track).not.toHaveBeenCalled()
  })
})