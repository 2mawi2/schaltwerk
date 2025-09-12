import { resolveOpenPathForOpenButton } from './resolveOpenPath'
import { TauriCommands } from '../common/tauriCommands'

type InvokeFn = <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>

describe('resolveOpenPathForOpenButton', () => {
  const base = {
    activeTabPath: '/repo',
    projectPath: '/repo',
  }

  it('returns selection.worktreePath when session running and worktree present', async () => {
    const selection = { kind: 'session' as const, payload: 's1', worktreePath: '/wt/s1', sessionState: 'running' as const }
    const invoke = vi.fn() as InvokeFn
    const path = await resolveOpenPathForOpenButton({ selection, ...base, invoke })
    expect(path).toBe('/wt/s1')
    expect(invoke).not.toHaveBeenCalled()
  })

  it('fetches session and returns worktree when running', async () => {
    const selection = { kind: 'session' as const, payload: 's2', sessionState: 'running' as const }
    const invoke = vi.fn().mockImplementation(async (cmd: string) => {
      if (cmd === TauriCommands.SchaltwerkCoreGetSession) return { session_state: 'running', worktree_path: '/wt/s2' }
      return null
    }) as InvokeFn
    const path = await resolveOpenPathForOpenButton({ selection, ...base, invoke })
    expect(path).toBe('/wt/s2')
  })

  it('falls back to project when spec or missing', async () => {
    const selection = { kind: 'session' as const, payload: 's3', sessionState: 'spec' as const }
    const invoke = vi.fn() as InvokeFn
    const path = await resolveOpenPathForOpenButton({ selection, ...base, invoke })
    expect(path).toBe('/repo')
  })

  it('falls back to project when backend fetch fails', async () => {
    const selection = { kind: 'session' as const, payload: 's4', sessionState: 'running' as const }
    const invoke = vi.fn().mockImplementation(async () => { throw new Error('boom') }) as InvokeFn
    const path = await resolveOpenPathForOpenButton({ selection, ...base, invoke })
    expect(path).toBe('/repo')
  })
})
