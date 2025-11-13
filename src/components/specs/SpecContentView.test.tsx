import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import React from 'react'
import { SpecContentView } from './SpecContentView'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('../../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn(),
  }
}))

vi.mock('../common/AnimatedText', () => ({
  AnimatedText: ({ text }: { text: string }) => <div data-testid="animated-text">{text}</div>
}))

vi.mock('./MarkdownEditor', () => ({
  MarkdownEditor: React.forwardRef<HTMLDivElement, { value: string; onChange: (value: string) => void; readOnly?: boolean; className?: string }>(
    ({ value }, _ref) => <div data-testid="markdown-editor">{value}</div>
  )
}))

describe('SpecContentView', () => {
  beforeEach(() => {
    vi.resetAllMocks()
  })

  it('clears previous session content before loading a new session', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>

    const deferred = () => {
      let resolve: (value: [string | null, string | null]) => void
      const promise = new Promise<[string | null, string | null]>((res) => {
        resolve = res
      })
      return { promise, resolve: resolve! }
    }

    const secondSessionDeferred = deferred()

    mockInvoke.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
      if (args?.name === 'session-one') {
        return ['Session one spec', null]
      }
      if (args?.name === 'session-two') {
        return secondSessionDeferred.promise
      }
      return [null, null]
    })

    const { rerender } = render(<SpecContentView sessionName="session-one" editable={false} />)

    await screen.findByText('Session one spec')

    rerender(<SpecContentView sessionName="session-two" editable={false} />)

    await waitFor(() => {
      expect(screen.queryByText('Session one spec')).toBeNull()
    })

    secondSessionDeferred.resolve(['Session two spec', null])

    await screen.findByText('Session two spec')
  })

  it('reuses cached spec content when returning to a session', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>

    const deferred = () => {
      let resolve: (value: [string | null, string | null]) => void
      const promise = new Promise<[string | null, string | null]>((res) => {
        resolve = res
      })
      return { promise, resolve: resolve! }
    }

    const alphaDeferred = deferred()
    let alphaCalls = 0

    mockInvoke.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
      if (args?.name === 'alpha') {
        alphaCalls += 1
        if (alphaCalls === 1) {
          return ['Alpha draft', null]
        }
        return alphaDeferred.promise
      }
      if (args?.name === 'beta') {
        return ['Beta draft', null]
      }
      return [null, null]
    })

    const { rerender } = render(<SpecContentView sessionName="alpha" editable={false} />)
    await screen.findByText('Alpha draft')

    rerender(<SpecContentView sessionName="beta" editable={false} />)
    await screen.findByText('Beta draft')

    rerender(<SpecContentView sessionName="alpha" editable={false} />)

    await waitFor(() => {
      expect(screen.getByText('Alpha draft')).toBeInTheDocument()
      expect(screen.queryByText('Beta draft')).toBeNull()
    })

    alphaDeferred.resolve(['Alpha refreshed', null])
    await screen.findByText('Alpha refreshed')
  })

  it('ignores late responses from previous sessions', async () => {
    const { invoke } = await import('@tauri-apps/api/core')
    const mockInvoke = invoke as ReturnType<typeof vi.fn>

    const deferred = () => {
      let resolve: (value: [string | null, string | null]) => void
      const promise = new Promise<[string | null, string | null]>((res) => {
        resolve = res
      })
      return { promise, resolve: resolve! }
    }

    const alphaDeferred = deferred()

    mockInvoke.mockImplementation(async (_cmd: string, args?: Record<string, unknown>) => {
      if (args?.name === 'alpha') {
        return alphaDeferred.promise
      }
      if (args?.name === 'beta') {
        return ['Beta live spec', null]
      }
      return [null, null]
    })

    const { rerender } = render(<SpecContentView sessionName="alpha" editable={false} />)

    rerender(<SpecContentView sessionName="beta" editable={false} />)
    await screen.findByText('Beta live spec')

    alphaDeferred.resolve(['Alpha late spec', null])

    await waitFor(() => {
      expect(screen.getByText('Beta live spec')).toBeInTheDocument()
      expect(screen.queryByText('Alpha late spec')).toBeNull()
    })
  })
})
