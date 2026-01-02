import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider, createStore } from 'jotai'
import { vi } from 'vitest'
import { ThemeSettings } from '../ThemeSettings'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}))

vi.mock('../../../common/themes/cssInjector', () => ({
  applyThemeToDOM: vi.fn(),
}))

vi.mock('../../../common/uiEvents', () => ({
  emitUiEvent: vi.fn(),
  UiEvent: { ThemeChanged: 'ThemeChanged' },
}))

const renderThemeSettings = () => {
  const store = createStore()
  const user = userEvent.setup()

  render(
    <Provider store={store}>
      <ThemeSettings />
    </Provider>
  )

  return { user }
}

describe('ThemeSettings', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('marks the active theme as selected', () => {
    renderThemeSettings()

    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('updates selection when a theme is chosen', async () => {
    const { user } = renderThemeSettings()

    const darkButton = screen.getByRole('button', { name: 'Dark' })

    await user.click(darkButton)

    expect(darkButton).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'System' })).toHaveAttribute('aria-pressed', 'false')
  })
})
