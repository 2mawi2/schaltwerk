import { describe, it, expect, vi } from 'vitest'
import { renderWithProviders } from '../../tests/test-utils'
import { act } from '@testing-library/react'
import { WebPreviewPanel } from './WebPreviewPanel'
import { Provider, createStore } from 'jotai'
import { setPreviewUrlActionAtom } from '../../store/atoms/preview'

vi.mock('../../features/preview/previewIframeRegistry', () => ({
  mountIframe: vi.fn(),
  unmountIframe: vi.fn(),
  setIframeUrl: vi.fn(),
  refreshIframe: vi.fn(),
}))

describe('WebPreviewPanel preview input sync', () => {
  it('shows the latest auto-detected URL', async () => {
    const store = createStore()
    const { getByLabelText } = renderWithProviders(
      <Provider store={store}>
        <WebPreviewPanel previewKey="pk" />
      </Provider>
    )

    const input = getByLabelText('Preview URL') as HTMLInputElement

    await act(async () => {
      store.set(setPreviewUrlActionAtom, { key: 'pk', url: 'http://localhost:3000' })
    })
    expect(input.value).toBe('http://localhost:3000')

    await act(async () => {
      store.set(setPreviewUrlActionAtom, { key: 'pk', url: 'http://localhost:3001' })
    })

    expect(input.value).toBe('http://localhost:3001')
  })
})
