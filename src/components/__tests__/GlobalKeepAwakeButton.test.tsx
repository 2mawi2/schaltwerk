import { describe, it, expect, beforeEach, vi } from 'vitest'
import { Provider, createStore } from 'jotai'
import { render, screen, act } from '@testing-library/react'
import { GlobalKeepAwakeButton } from '../GlobalKeepAwakeButton'
import { keepAwakeStateAtom, powerSettingsAtom } from '../../store/atoms/powerSettings'
import { invoke } from '@tauri-apps/api/core'

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }))
vi.mock('../../common/eventSystem', () => ({
  listenEvent: vi.fn(() => Promise.resolve(() => {})),
  SchaltEvent: {
    GlobalKeepAwakeStateChanged: 'schaltwerk:global-keep-awake-state-changed',
  },
}))
vi.mock('../../utils/logger', () => ({
  logger: {
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}))

async function renderWithState(state: 'disabled' | 'active' | 'auto_paused') {
  const store = createStore()
  store.set(keepAwakeStateAtom, state)
  store.set(powerSettingsAtom, { autoReleaseEnabled: true, autoReleaseIdleMinutes: 2 })
  vi.mocked(invoke).mockResolvedValue(state)

  let utils: ReturnType<typeof render> | undefined
  await act(async () => {
    utils = render(
      <Provider store={store}>
        <GlobalKeepAwakeButton />
      </Provider>
    )
  })
  return utils!
}

describe('GlobalKeepAwakeButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders auto-pause indicator', async () => {
    const { queryByTestId } = await renderWithState('auto_paused')

    expect(queryByTestId('keep-awake-autopause-indicator')).not.toBeNull()
  })

  it('renders active state without indicator', async () => {
    const { queryByTestId } = await renderWithState('active')

    expect(queryByTestId('keep-awake-autopause-indicator')).toBeNull()
  })

  it('renders disabled tooltip text', async () => {
    await renderWithState('disabled')
    expect(screen.getByLabelText('Toggle keep-awake').getAttribute('title')).toMatch(
      /Keep machine awake while agents work/
    )
  })
})
