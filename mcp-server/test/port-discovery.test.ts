import { beforeEach, afterEach, describe, it, expect, mock } from 'bun:test'
import fs from 'fs'
import os from 'os'
import path from 'path'

const mockFetch = mock(() => Promise.resolve({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => '[]',
  json: async () => []
}))

mock.module('node-fetch', () => ({
  default: mockFetch
}))

const { SchaltwerkBridge } = await import('../src/schaltwerk-bridge')

const createResponse = (payload: unknown) => ({
  ok: true,
  status: 200,
  statusText: 'OK',
  text: async () => JSON.stringify(payload),
  json: async () => payload
})

const createConnectionError = (message: string) => {
  const error = new Error(message) as NodeJS.ErrnoException
  error.code = 'ECONNREFUSED'
  return error
}

describe('SchaltwerkBridge port discovery', () => {
  let tempDir: string

  beforeEach(() => {
    mockFetch.mockReset()

    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'schaltwerk-port-test-'))
    process.env.SCHALTWERK_PROJECT_PATH = tempDir
    delete process.env.SCHALTWERK_MCP_PORT
  })

  afterEach(() => {
    delete process.env.SCHALTWERK_PROJECT_PATH
    delete process.env.SCHALTWERK_MCP_PORT
    if (tempDir && fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('retries alternate ports after connection errors and remembers the working port', async () => {
    const isoNow = new Date().toISOString()
    const worktreePath = path.join(tempDir, '.schaltwerk', 'worktrees', 'session-1')

    const enrichedSessions = [
      {
        info: {
          session_id: 'session-1',
          display_name: 'session-1',
          branch: 'schaltwerk/session-1',
          base_branch: 'main',
          worktree_path: worktreePath,
          session_state: 'Running',
          created_at: isoNow,
          updated_at: isoNow,
          last_activity: isoNow,
          ready_to_merge: false,
          initial_prompt: null,
          draft_content: null,
          spec_content: null,
          original_agent_type: null,
          original_skip_permissions: null,
          pending_name_generation: false,
          was_auto_generated: false
        }
      }
    ]

    const expectedSessions = [
      {
        id: 'session-1',
        name: 'session-1',
        display_name: 'session-1',
        repository_path: '',
        repository_name: '',
        branch: 'schaltwerk/session-1',
        parent_branch: 'main',
        worktree_path: worktreePath,
        status: 'active',
        session_state: 'Running',
        created_at: new Date(isoNow).getTime(),
        updated_at: new Date(isoNow).getTime(),
        last_activity: new Date(isoNow).getTime(),
        initial_prompt: undefined,
        draft_content: undefined,
        spec_content: undefined,
        ready_to_merge: false,
        original_agent_type: undefined,
        original_skip_permissions: undefined,
        pending_name_generation: false,
        was_auto_generated: false
      }
    ]

    mockFetch
      .mockRejectedValueOnce(createConnectionError('connect ECONNREFUSED 127.0.0.1:8547'))
      .mockResolvedValueOnce(createResponse(enrichedSessions))
      .mockResolvedValueOnce(createResponse(enrichedSessions))

    const bridge = new SchaltwerkBridge()

    const firstResult = await bridge.listSessions()
    expect(firstResult).toEqual(expectedSessions)
    expect(mockFetch).toHaveBeenCalledTimes(2)
    expect(mockFetch.mock.calls[0][0]).not.toEqual(mockFetch.mock.calls[1][0])

    const secondResult = await bridge.listSessions()
    expect(secondResult).toEqual(expectedSessions)
    expect(mockFetch).toHaveBeenCalledTimes(3)
    expect(mockFetch.mock.calls[2][0]).toEqual(mockFetch.mock.calls[1][0])
  })
})
