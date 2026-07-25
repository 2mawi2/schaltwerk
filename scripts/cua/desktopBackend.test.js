import { describe, expect, it } from 'vitest'

import { buildCuaClientArgs, resolveBackendName } from './desktopBackend.js'

describe('resolveBackendName', () => {
  it('defaults to cua when no backend is provided', () => {
    expect(resolveBackendName(undefined)).toBe('cua')
  })

  it('normalizes supported backend names', () => {
    expect(resolveBackendName('DesktopCtl')).toBe('desktopctl')
  })

  it('rejects unsupported backends', () => {
    expect(() => resolveBackendName('vnc')).toThrow('Unsupported desktop backend')
  })
})

describe('buildCuaClientArgs', () => {
  it('builds a reproducible uv invocation for the cua helper', () => {
    expect(
      buildCuaClientArgs({
        scriptPath: 'scripts/cua/cua-computer-client.py',
        host: '127.0.0.1',
        port: '8002',
        command: 'execute-plan',
        args: ['plan.json'],
      })
    ).toEqual([
      'run',
      '--quiet',
      '--with',
      'cua-computer',
      'python',
      'scripts/cua/cua-computer-client.py',
      '--host',
      '127.0.0.1',
      '--port',
      '8002',
      'execute-plan',
      'plan.json',
    ])
  })
})
