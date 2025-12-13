import { describe, it, expect, beforeEach, vi } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Provider, createStore } from 'jotai'
import { WebPreviewPanel } from './WebPreviewPanel'
import * as previewRegistry from '../../features/preview/previewIframeRegistry'
import { PREVIEW_ZOOM_STEP } from '../../store/atoms/preview'

const { __resetRegistryForTests } = previewRegistry

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(undefined)
}))

const renderPanel = (props: React.ComponentProps<typeof WebPreviewPanel>) => {
  const store = createStore()
  return render(
    <Provider store={store}>
      <WebPreviewPanel {...props} />
    </Provider>
  )
}

describe('WebPreviewPanel', () => {
  beforeEach(() => {
    __resetRegistryForTests()
  })

  it('shows empty state when no URL is configured', () => {
    renderPanel({ previewKey: 'test-key' })
    expect(screen.getByText('Browser')).toBeInTheDocument()
    expect(screen.getByText('Enter a URL above to load your preview.')).toBeInTheDocument()
  })

  it('allows user to enter and navigate to a URL', async () => {
    const user = userEvent.setup()
    const mountSpy = vi.spyOn(previewRegistry, 'mountIframe')
    const setUrlSpy = vi.spyOn(previewRegistry, 'setIframeUrl')

    renderPanel({ previewKey: 'test-key' })

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, 'localhost:3000')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(setUrlSpy).toHaveBeenCalledWith('test-key', 'http://localhost:3000')
      expect(mountSpy).toHaveBeenCalled()
    })
  })

  it('normalizes port numbers to localhost URLs', async () => {
    const user = userEvent.setup()
    const setUrlSpy = vi.spyOn(previewRegistry, 'setIframeUrl')

    renderPanel({ previewKey: 'test-key' })

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, '5173')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(setUrlSpy).toHaveBeenCalledWith('test-key', 'http://localhost:5173')
    })
  })

  it('shows error for invalid URLs', async () => {
    const user = userEvent.setup()
    renderPanel({ previewKey: 'test-key' })

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, 'ftp://invalid-protocol')
    await user.click(screen.getByLabelText('Navigate'))

    expect(await screen.findByText(/Enter a valid http/i)).toBeInTheDocument()
  })

  it('pauses iframe when isResizing is true', () => {
    renderPanel({ previewKey: 'test-key', isResizing: true })
    expect(screen.queryByText(/preview paused while resizing/i)).toBeInTheDocument()
  })

  it('unmounts iframe when switching away', async () => {
    const user = userEvent.setup()
    const unmountSpy = vi.spyOn(previewRegistry, 'unmountIframe')
    const setUrlSpy = vi.spyOn(previewRegistry, 'setIframeUrl')

    const { unmount } = renderPanel({ previewKey: 'test-key' })

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, 'localhost:3000')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(setUrlSpy).toHaveBeenCalled()
    })

    unmount()

    expect(unmountSpy).toHaveBeenCalledWith('test-key')
  })

  it('calls refreshIframe on hard reload button click', async () => {
    const user = userEvent.setup()
    const refreshSpy = vi.spyOn(previewRegistry, 'refreshIframe')
    const setUrlSpy = vi.spyOn(previewRegistry, 'setIframeUrl')

    renderPanel({ previewKey: 'test-key' })

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, 'localhost:3000')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(setUrlSpy).toHaveBeenCalledWith('test-key', 'http://localhost:3000')
    })

    refreshSpy.mockClear()
    await user.click(screen.getByLabelText('Hard reload'))

    expect(refreshSpy).toHaveBeenCalledWith('test-key', true)
  })

  it('persists preview state per key', async () => {
    const user = userEvent.setup()
    const setUrlSpy = vi.spyOn(previewRegistry, 'setIframeUrl')

    const { rerender } = render(
      <Provider>
        <WebPreviewPanel previewKey="key-1" />
      </Provider>
    )

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, 'localhost:3000')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(setUrlSpy).toHaveBeenCalledWith('key-1', 'http://localhost:3000')
    })

    setUrlSpy.mockClear()

    rerender(
      <Provider>
        <WebPreviewPanel previewKey="key-2" />
      </Provider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Preview URL')).toHaveValue('')
    })

    rerender(
      <Provider>
        <WebPreviewPanel previewKey="key-1" />
      </Provider>
    )

    await waitFor(() => {
      expect(screen.getByLabelText('Preview URL')).toHaveValue('http://localhost:3000')
    })
  })

  it('enables back/forward navigation based on history', async () => {
    const user = userEvent.setup()
    const setUrlSpy = vi.spyOn(previewRegistry, 'setIframeUrl')

    renderPanel({ previewKey: 'test-key' })

    const back = screen.getByLabelText('Back')
    const forward = screen.getByLabelText('Forward')

    expect(back).toBeDisabled()
    expect(forward).toBeDisabled()

    const input = screen.getByLabelText('Preview URL')
    await user.clear(input)
    await user.type(input, 'localhost:3000')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(setUrlSpy).toHaveBeenCalledWith('test-key', 'http://localhost:3000')
    })

    expect(back).toBeDisabled()
    expect(forward).toBeDisabled()

    await user.clear(input)
    await user.type(input, 'localhost:4173')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(back).not.toBeDisabled()
      expect(forward).toBeDisabled()
    })

    await user.click(back)

    await waitFor(() => {
      expect(setUrlSpy).toHaveBeenCalledWith('test-key', 'http://localhost:3000')
      expect(forward).not.toBeDisabled()
    })
  })

  it('can open the current URL in an external browser', async () => {
    const user = userEvent.setup()
    const { invoke } = await import('@tauri-apps/api/core')
    const invokeSpy = vi.mocked(invoke)

    renderPanel({ previewKey: 'test-key' })

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, 'localhost:3000')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(screen.getByLabelText('Preview URL')).toHaveValue('http://localhost:3000')
    })

    invokeSpy.mockClear()
    await user.click(screen.getByLabelText('Open in browser'))

    await waitFor(() => {
      expect(invokeSpy).toHaveBeenCalledWith('open_external_url', { url: 'http://localhost:3000' })
    })
  })

  it('allows manual zooming through the toolbar popover', async () => {
    const user = userEvent.setup()

    renderPanel({ previewKey: 'test-key' })

    const input = screen.getByLabelText('Preview URL')
    await user.type(input, 'localhost:3000')
    await user.click(screen.getByLabelText('Navigate'))

    await waitFor(() => {
      expect(document.querySelector('iframe[data-preview-key="test-key"]')).not.toBeNull()
    })

    await user.click(screen.getByRole('button', { name: 'Adjust zoom' }))
    expect(await screen.findByText('Reset')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Zoom in' }))

    await waitFor(() => {
      const zoomHost = document.querySelector('[data-preview-zoom]')
      expect(zoomHost).toHaveAttribute('data-preview-zoom', (1 + PREVIEW_ZOOM_STEP).toFixed(2))
    })

    await user.click(screen.getByRole('button', { name: 'Reset' }))

    await waitFor(() => {
      const zoomHost = document.querySelector('[data-preview-zoom]')
      expect(zoomHost).toHaveAttribute('data-preview-zoom', '1.00')
    })
  })
})
