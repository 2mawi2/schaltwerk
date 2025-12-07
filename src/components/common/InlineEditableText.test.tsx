import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { InlineEditableText } from './InlineEditableText'

describe('InlineEditableText', () => {
  it('renders the value as text by default', () => {
    render(<InlineEditableText value="test-session" onSave={vi.fn()} />)
    expect(screen.getByText('test-session')).toBeInTheDocument()
  })

  it('enters edit mode on double-click', async () => {
    const user = userEvent.setup()
    render(<InlineEditableText value="test-session" onSave={vi.fn()} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))

    expect(screen.getByRole('textbox')).toBeInTheDocument()
    expect(screen.getByRole('textbox')).toHaveValue('test-session')
  })

  it('saves on Enter key', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<InlineEditableText value="old-name" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'new-name{enter}')

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('new-name')
    })
  })

  it('cancels on Escape key', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<InlineEditableText value="original" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'changed{escape}')

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByText('original')).toBeInTheDocument()
  })

  it('saves on blur', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(
      <div>
        <InlineEditableText value="old-name" onSave={onSave} />
        <button>Other</button>
      </div>
    )

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'new-name')
    await user.click(screen.getByRole('button', { name: 'Other' }))

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('new-name')
    })
  })

  it('does not save if value unchanged', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<InlineEditableText value="same-name" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
  })

  it('shows error for empty name', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<InlineEditableText value="test" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    fireEvent.keyDown(screen.getByRole('textbox'), { key: 'Enter' })

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveClass('border-red-500')
  })

  it('disables interaction when disabled prop is true', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<InlineEditableText value="test" onSave={onSave} disabled />)

    await user.dblClick(screen.getByText('test'))  // No title when disabled

    expect(screen.queryByRole('textbox')).not.toBeInTheDocument()
  })

  it('handles save error gracefully', async () => {
    const onSave = vi.fn().mockRejectedValue(new Error('Network error'))
    const user = userEvent.setup()
    render(<InlineEditableText value="test" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'new-name{enter}')

    await waitFor(() => {
      expect(screen.getByRole('textbox')).toHaveClass('border-red-500')
    })
  })

  it('respects maxLength prop', async () => {
    const user = userEvent.setup()
    render(<InlineEditableText value="test" onSave={vi.fn()} maxLength={10} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))

    expect(screen.getByRole('textbox')).toHaveAttribute('maxLength', '10')
  })

  it('shows error for special characters only (no alphanumeric)', async () => {
    const onSave = vi.fn()
    const user = userEvent.setup()
    render(<InlineEditableText value="test" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), '!!{enter}')

    expect(onSave).not.toHaveBeenCalled()
    expect(screen.getByRole('textbox')).toHaveClass('border-red-500')
  })

  it('allows names with special characters mixed with alphanumeric', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<InlineEditableText value="test" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'test!!{enter}')

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('test!!')
    })
  })

  it('allows spaces in names', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<InlineEditableText value="test" onSave={onSave} />)

    await user.dblClick(screen.getByTitle('Double-click to rename'))
    await user.clear(screen.getByRole('textbox'))
    await user.type(screen.getByRole('textbox'), 'my test name{enter}')

    await waitFor(() => {
      expect(onSave).toHaveBeenCalledWith('my test name')
    })
  })
})
