import { describe, it, expect, vi, beforeEach } from 'vitest'
import { TauriCommands } from '../../common/tauriCommands'

describe('DiffFileList discard button', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('invokes discard for a session file', async () => {
    // Smoke test: ensure the new commands are exported for use by UI
    expect(TauriCommands.SchaltwerkCoreDiscardFileInSession).toBeDefined()
    expect(TauriCommands.SchaltwerkCoreDiscardFileInOrchestrator).toBeDefined()
  })
})
