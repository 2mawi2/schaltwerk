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
    text: async () => JSON.stringify({ setup_script: '', has_setup_script: false }),
  })
)

mock.module('node-fetch', () => ({
  default: fetchMock,
}))

const { SchaltwerkBridge } = await import('../src/schaltwerk-bridge')

describe('SchaltwerkBridge setup script helpers', () => {
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

  it('fetches project setup script with project headers', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          setup_script: '#!/bin/bash\necho hi',
          has_setup_script: true,
        }),
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.getProjectSetupScript()

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/project/setup-script')
    expect(init?.method).toBe('GET')
    const headers = init?.headers as Record<string, string>
    expect(headers['X-Project-Path']).toBeDefined()
    expect(headers['X-Project-Hash']).toBeDefined()
    expect(result.setup_script).toContain('echo hi')
    expect(result.has_setup_script).toBe(true)
  })

  it('sets project setup script payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          setup_script: '#!/bin/bash\necho set',
          has_setup_script: true,
        }),
    })

    const bridge = new SchaltwerkBridge()
    const script = '#!/bin/bash\necho set'
    const result = await bridge.setProjectSetupScript(script)

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/project/setup-script')
    expect(init?.method).toBe('PUT')
    expect(init?.headers && (init.headers as Record<string, string>)['Content-Type']).toBe(
      'application/json'
    )
    expect(init?.body).toEqual(JSON.stringify({ setup_script: script }))
    expect(result.setup_script).toBe(script)
    expect(result.has_setup_script).toBe(true)
  })

  it('allows clearing the setup script (empty string)', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      statusText: 'OK',
      text: async () =>
        JSON.stringify({
          setup_script: '',
          has_setup_script: false,
        }),
    })

    const bridge = new SchaltwerkBridge()
    const result = await bridge.setProjectSetupScript('')

    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/api/project/setup-script')
    expect(init?.method).toBe('PUT')
    expect(init?.body).toEqual(JSON.stringify({ setup_script: '' }))
    expect(result.setup_script).toBe('')
    expect(result.has_setup_script).toBe(false)
  })
})
