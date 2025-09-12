import React from 'react'
import { vi } from 'vitest'

// We will mock react-dom/client to capture createRoot calls
const renderMock = vi.fn()
const createRootMock = vi.fn(() => ({ render: renderMock }))

vi.mock('react-dom/client', () => ({
  default: { createRoot: createRootMock },
  createRoot: createRootMock,
}))

// Mock App and providers to isolate entry setup
vi.mock('./App', () => ({ default: () => <div data-testid="app" /> }))
vi.mock('./contexts/SelectionContext', () => ({ SelectionProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="selection-provider">{children}</div> }))
vi.mock('./contexts/FocusContext', () => ({ FocusProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="focus-provider">{children}</div> }))
vi.mock('./contexts/ReviewContext', () => ({ ReviewProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="review-provider">{children}</div> }))
vi.mock('./contexts/ProjectContext', () => ({ ProjectProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="project-provider">{children}</div> }))
vi.mock('./contexts/FontSizeContext', () => ({ FontSizeProvider: ({ children }: { children: React.ReactNode }) => <div data-testid="font-size-provider">{children}</div> }))

// Need to mock styles imported in main
vi.mock('./index.css', () => ({}))

describe('main.tsx entry', () => {
  beforeEach(() => {
    vi.resetModules()
    renderMock.mockReset()
    createRootMock.mockClear()
    // Provide a root element in the DOM
    document.body.innerHTML = '<div id="root"></div>'
  })

  it('initializes React root and renders App tree', async () => {
    await import('./main')

    // createRoot should be called with the #root element
    const rootEl = document.getElementById('root')
    expect(createRootMock).toHaveBeenCalledWith(rootEl)
    expect(renderMock).toHaveBeenCalled()
  })

  it('handles missing root element by failing fast', async () => {
    document.body.innerHTML = ''

    // Make createRoot throw if called with null/undefined
    createRootMock.mockImplementationOnce((el?: Element | null) => {
      if (!el) throw new Error('Missing root element')
      return { render: renderMock }
    })

    await expect(import('./main')).rejects.toBeTruthy()
  })

  it('works with a mocked DOM element availability', async () => {
    // The beforeEach already injects a #root, just verify import succeeds
    await import('./main')
    expect(createRootMock).toHaveBeenCalled()
  })
})
