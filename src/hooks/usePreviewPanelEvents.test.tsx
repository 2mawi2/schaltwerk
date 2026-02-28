import React from 'react'
import { describe, it, expect, beforeEach } from 'vitest'
import { waitFor, act } from '@testing-library/react'
import { renderWithProviders } from '../tests/test-utils'
import { useAtomValue } from 'jotai'
import { rightPanelCollapsedAtom } from '../store/atoms/layout'
import { rightPanelTabAtom } from '../store/atoms/rightPanelTab'
import { emitUiEvent, UiEvent } from '../common/uiEvents'
import { usePreviewPanelEvents } from './usePreviewPanelEvents'
import { LocalPreviewWatcher } from '../features/preview/localPreview'
import { previewStateAtom, setPreviewUrlActionAtom } from '../store/atoms/preview'
import { useSetAtom } from 'jotai'

const Inspector = () => {
  usePreviewPanelEvents()
  const collapsed = useAtomValue(rightPanelCollapsedAtom)
  const tab = useAtomValue(rightPanelTabAtom)
  return (
    <div>
      <div data-testid="collapsed">{String(collapsed)}</div>
      <div data-testid="tab">{tab}</div>
    </div>
  )
}

describe('usePreviewPanelEvents', () => {
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    localStorage.setItem('schaltwerk:layout:rightPanelCollapsed', 'true')
  })

  it('opens the right panel and switches to preview tab when OpenPreviewPanel fires', async () => {
    const { getByTestId } = renderWithProviders(<Inspector />)

    expect(getByTestId('collapsed').textContent).toBe('true')
    expect(getByTestId('tab').textContent).toBe('changes')

    await act(async () => {
      emitUiEvent(UiEvent.OpenPreviewPanel, { previewKey: 'test' })
    })

    await waitFor(() => {
      expect(getByTestId('collapsed').textContent).toBe('false')
      expect(getByTestId('tab').textContent).toBe('preview')
    })
  })
})

const ClickHarness = () => {
  usePreviewPanelEvents()
  const setPreview = useSetAtom(setPreviewUrlActionAtom)
  const previewState = useAtomValue(previewStateAtom)('pk')
  const tab = useAtomValue(rightPanelTabAtom)
  const collapsed = useAtomValue(rightPanelCollapsedAtom)

  const watcherRef = React.useRef<LocalPreviewWatcher | null>(null)
  if (!watcherRef.current) {
    watcherRef.current = new LocalPreviewWatcher({
      previewKey: 'pk',
      interceptClicks: true,
      onUrl: (url) => setPreview({ key: 'pk', url }),
      onOpenPreviewPanel: () => emitUiEvent(UiEvent.OpenPreviewPanel, { previewKey: 'pk' }),
    })
  }

  return (
    <div>
      <button data-testid="click" onClick={() => watcherRef.current?.handleClick('http://localhost:4000')}>
        click
      </button>
      <div data-testid="collapsed">{String(collapsed)}</div>
      <div data-testid="tab">{tab}</div>
      <div data-testid="url">{previewState.url ?? ''}</div>
    </div>
  )
}

it('sets preview URL when OpenPreviewPanel event includes a url', async () => {
  localStorage.setItem('schaltwerk:layout:rightPanelCollapsed', 'true')
  const UrlInspector = () => {
    usePreviewPanelEvents()
    const collapsed = useAtomValue(rightPanelCollapsedAtom)
    const tab = useAtomValue(rightPanelTabAtom)
    const state = useAtomValue(previewStateAtom)('test-key')
    return (
      <div>
        <div data-testid="collapsed">{String(collapsed)}</div>
        <div data-testid="tab">{tab}</div>
        <div data-testid="url">{state.url ?? ''}</div>
      </div>
    )
  }
  const { getByTestId } = renderWithProviders(<UrlInspector />)

  expect(getByTestId('collapsed').textContent).toBe('true')
  expect(getByTestId('tab').textContent).toBe('changes')
  expect(getByTestId('url').textContent).toBe('')

  await act(async () => {
    emitUiEvent(UiEvent.OpenPreviewPanel, { previewKey: 'test-key', url: 'https://github.com/org/repo/pull/42' })
  })

  await waitFor(() => {
    expect(getByTestId('collapsed').textContent).toBe('false')
    expect(getByTestId('tab').textContent).toBe('preview')
    expect(getByTestId('url').textContent).toBe('https://github.com/org/repo/pull/42')
  })
})

it('click interception opens sidebar and updates preview URL', async () => {
  localStorage.setItem('schaltwerk:layout:rightPanelCollapsed', 'true')
  const { getByTestId } = renderWithProviders(<ClickHarness />)

  expect(getByTestId('collapsed').textContent).toBe('true')
  expect(getByTestId('tab').textContent).toBe('changes')

  await act(async () => {
    getByTestId('click').click()
  })

  await waitFor(() => {
    expect(getByTestId('collapsed').textContent).toBe('false')
    expect(getByTestId('tab').textContent).toBe('preview')
    expect(getByTestId('url').textContent).toBe('http://localhost:4000')
  })
})
