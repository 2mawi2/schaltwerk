import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { Dropdown } from './Dropdown'

function DropdownHarness() {
  const [open, setOpen] = useState(false)

  return (
    <Dropdown
      open={open}
      onOpenChange={setOpen}
      items={[
        { key: 'one', label: 'One' },
        { key: 'two', label: 'Two' },
      ]}
      onSelect={() => setOpen(false)}
      menuTestId="dropdown-menu"
    >
      {({ toggle }) => (
        <button type="button" onClick={toggle}>
          Toggle
        </button>
      )}
    </Dropdown>
  )
}

describe('Dropdown', () => {
  test('renders the menu using a portal positioned relative to the viewport', async () => {
    const user = userEvent.setup()
    render(<DropdownHarness />)

    await user.click(screen.getByRole('button', { name: 'Toggle' }))

    const menu = await screen.findByTestId('dropdown-menu')

    expect(menu.parentElement).toBe(document.body)
    expect(window.getComputedStyle(menu).position).toBe('fixed')
  })
})
