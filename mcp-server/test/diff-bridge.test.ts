import { afterEach, beforeEach, describe, expect, it, mock, spyOn } from 'bun:test'
import path from 'path'

const fetchMock = mock<
  Parameters<typeof fetch>,
  Promise<{ ok: boolean; status: number; statusText: string; text: () => Promise<string> }>
>(() =>
  Promise.resolve({
    ok: true,
    status: 200,
    statusText: 'OK',
    text: async () => JSON.stringify({ sample: true }),
  })
)

mock.module('node-fetch', () => ({
  default: fetchMock,
}))

const { SchaltwerkBridge } = await import('../src/schaltwerk-bridge')

describe('SchaltwerkBridge diff helpers', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchMock.mockReset()
    process.env.SCHALTWERK_PROJECT_PATH = path.resolve(__dirname, '..', '..')
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    delete process.env.SCHALTWERK_PROJECT_PATH
  })

  it('fetches diff summary with session pagination params', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          scope: 'session',
          session_id: 'fiery_maxwell',
          branch_info: {
            current_branch: 'schaltwerk/fiery_maxwell',
            parent_branch: 'main',
            merge_base_short: 'abc1234',
            head_short: 'def5678',
          },
          has_spec: true,
          files: [{ path: 'src/app.ts', change_type: 'modified' }],
          paging: { next_cursor: 'cursor-2', total_files: 12, returned: 5 },
        }),
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.getDiffSummary({ session: 'fiery_maxwell', cursor: 'cursor-1', pageSize: 5 })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/api/diff/summary')
    expect(parsed.searchParams.get('session')).toBe('fiery_maxwell')
    expect(parsed.searchParams.get('cursor')).toBe('cursor-1')
    expect(parsed.searchParams.get('page_size')).toBe('5')
    expect(result.scope).toBe('session')
    expect(result.paging.next_cursor).toBe('cursor-2')
  })

  it('fetches diff summary without session parameter for orchestrator scope', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          scope: 'orchestrator',
          branch_info: {
            current_branch: 'main',
            parent_branch: 'origin/main',
            merge_base_short: '123abcd',
            head_short: '987zyxw',
          },
          has_spec: false,
          files: [{ path: 'README.md', change_type: 'modified' }],
          paging: { next_cursor: null, total_files: 1, returned: 1 },
        }),
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.getDiffSummary({ pageSize: 50 })

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/api/diff/summary')
    expect(parsed.searchParams.get('page_size')).toBe('50')
    expect(url).not.toContain('session=')
    expect(result.scope).toBe('orchestrator')
  })

  it('fetches diff chunk with cursor and line limit', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          file: { path: 'src/app.ts', change_type: 'modified' },
          branch_info: {
            current_branch: 'schaltwerk/fiery_maxwell',
            parent_branch: 'main',
            merge_base_short: 'abc1234',
            head_short: 'def5678',
          },
          stats: { additions: 10, deletions: 2 },
          is_binary: false,
          lines: [{ content: 'const a = 1', line_type: 'added', new_line_number: 3 }],
          paging: { cursor: 'cursor-1', next_cursor: 'cursor-2', returned: 1 },
        }),
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.getDiffChunk({
      session: 'fiery_maxwell',
      path: 'src/app.ts',
      cursor: 'cursor-1',
      lineLimit: 400,
    })

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/api/diff/file')
    expect(parsed.searchParams.get('session')).toBe('fiery_maxwell')
    expect(parsed.searchParams.get('path')).toBe('src/app.ts')
    expect(parsed.searchParams.get('cursor')).toBe('cursor-1')
    expect(parsed.searchParams.get('line_limit')).toBe('400')
    expect(result.paging.next_cursor).toBe('cursor-2')
  })

  it('throws descriptive error when diff chunk request fails', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 422,
      statusText: 'Unprocessable Entity',
      text: async () => JSON.stringify({ error: 'line_limit must be <= 1000' }),
    })

    const bridge = new SchaltwerkBridge()
    await expect(
      bridge.getDiffChunk({ path: 'src/app.ts', lineLimit: 5000 })
    ).rejects.toThrow('Failed to fetch diff chunk: 422 Unprocessable Entity - line_limit must be <= 1000')
  })

  it('fetches session spec by identifier', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          session_id: 'fiery_maxwell',
          content: '# Spec',
          updated_at: '2024-05-01T12:34:56Z',
        }),
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.getSessionSpec('fiery_maxwell')
    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
   expect(parsed.pathname).toBe('/api/sessions/fiery_maxwell/spec')
    expect(result.content).toBe('# Spec')
  })
})

describe('SchaltwerkBridge spec helpers', () => {
  let consoleErrorSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    fetchMock.mockReset()
    process.env.SCHALTWERK_PROJECT_PATH = path.resolve(__dirname, '..', '..')
    consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => {})
  })

  afterEach(() => {
    consoleErrorSpy.mockRestore()
    delete process.env.SCHALTWERK_PROJECT_PATH
  })

  it('lists spec summaries with content length metadata', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          specs: [
            {
              session_id: 'alpha_spec',
              display_name: 'Alpha Spec',
              content_length: 128,
              updated_at: '2024-05-01T12:00:00Z',
            },
          ],
        }),
    })

    const bridge = new SchaltwerkBridge()
    const items = await bridge.listSpecSummaries()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/api/specs/summary')
    expect(items).toHaveLength(1)
    expect(items[0].session_id).toBe('alpha_spec')
    expect(items[0].content_length).toBe(128)
  })

  it('fetches spec document content for a given session', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          session_id: 'beta_spec',
          display_name: 'Beta Spec',
          content: '# Spec\n\nDetails',
          content_length: 18,
          updated_at: '2024-05-02T12:00:00Z',
        }),
    })

    const bridge = new SchaltwerkBridge()
    const doc = await bridge.getSpecDocument('beta_spec')

    const [url] = fetchMock.mock.calls[0]
    const parsed = new URL(String(url))
    expect(parsed.pathname).toBe('/api/specs/beta_spec')
    expect(doc?.session_id).toBe('beta_spec')
    expect(doc?.content_length).toBe(18)
  })

  it('validates required session name when fetching spec documents', async () => {
    const bridge = new SchaltwerkBridge()
    await expect(bridge.getSpecDocument('')).rejects.toThrow('sessionName is required to fetch a spec')
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
