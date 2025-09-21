import { describe, it, expect, vi, beforeEach } from 'vitest'
import { computeProjectOrchestratorId, computeSpawnSize, RIGHT_EDGE_GUARD_COLUMNS, startSessionTop, startOrchestratorTop } from './agentSpawn'
import { TauriCommands } from './tauriCommands'

// Mock dependencies
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('./terminalSizeCache', () => ({
  bestBootstrapSize: vi.fn()
}))

vi.mock('./uiEvents', () => ({
  markBackgroundStart: vi.fn(),
  clearBackgroundStarts: vi.fn()
}))

vi.mock('../utils/singleflight', () => ({
  singleflight: vi.fn(),
  hasInflight: vi.fn()
}))

import { invoke } from '@tauri-apps/api/core'
import { bestBootstrapSize } from './terminalSizeCache'
import { markBackgroundStart, clearBackgroundStarts } from './uiEvents'
import { singleflight, hasInflight } from '../utils/singleflight'

describe('agentSpawn', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  describe('computeProjectOrchestratorId', () => {
    it('returns null for null/undefined project path', () => {
      expect(computeProjectOrchestratorId(null)).toBe(null)
      expect(computeProjectOrchestratorId(undefined)).toBe(null)
    })

    it('generates consistent orchestrator ID for same project path', () => {
      const path = '/Users/test/my-project'
      const id1 = computeProjectOrchestratorId(path)
      const id2 = computeProjectOrchestratorId(path)

      expect(id1).toBe(id2)
      expect(id1).toMatch(/^orchestrator-my-project-[a-f0-9]{6}-top$/)
    })

    it('handles paths with special characters', () => {
      const path = '/Users/test/my-project@2024'
      const id = computeProjectOrchestratorId(path)

      expect(id).toMatch(/^orchestrator-my-project_2024-[a-f0-9]{6}-top$/)
    })

    it('generates different IDs for different project paths', () => {
      const id1 = computeProjectOrchestratorId('/Users/test/project-a')
      const id2 = computeProjectOrchestratorId('/Users/test/project-b')

      expect(id1).not.toBe(id2)
    })

    it('uses last path segment as base name', () => {
      const path = '/very/long/path/to/my-project'
      const id = computeProjectOrchestratorId(path)

      expect(id).toMatch(/^orchestrator-my-project-/)
    })
  })

  describe('computeSpawnSize', () => {
    beforeEach(() => {
      vi.mocked(bestBootstrapSize).mockReturnValue({ cols: 120, rows: 40 })
    })

    it('applies guard columns to measured size', () => {
      const result = computeSpawnSize({
        topId: 'session-test-top',
        measured: { cols: 120, rows: 40 }
      })

      expect(result).toEqual({
        cols: 120 - RIGHT_EDGE_GUARD_COLUMNS,
        rows: 40
      })
    })

    it('does not modify rows when applying measured size', () => {
      const result = computeSpawnSize({
        topId: 'session-test-top',
        measured: { cols: 150, rows: 50 }
      })

      expect(result).toEqual({
        cols: 148, // 150 - 2
        rows: 50   // unchanged
      })
    })

    it('falls back to bootstrap size when no measured size', () => {
      const result = computeSpawnSize({
        topId: 'session-test-top'
      })

      expect(bestBootstrapSize).toHaveBeenCalledWith({
        topId: 'session-test-top',
        projectOrchestratorId: undefined
      })
      expect(result).toEqual({
        cols: 118, // 120 - 2
        rows: 40
      })
    })

    it('passes projectOrchestratorId to bootstrap size', () => {
      const orchestratorId = 'orchestrator-test-123456-top'
      computeSpawnSize({
        topId: 'session-test-top',
        projectOrchestratorId: orchestratorId
      })

      expect(bestBootstrapSize).toHaveBeenCalledWith({
        topId: 'session-test-top',
        projectOrchestratorId: orchestratorId
      })
    })

    it('enforces minimum column size', () => {
      const result = computeSpawnSize({
        topId: 'session-test-top',
        measured: { cols: 3, rows: 20 } // 3 - 2 = 1, but min is 2
      })

      expect(result).toEqual({
        cols: 2, // MIN enforced
        rows: 20
      })
    })

    it('handles partial measured size (missing rows)', () => {
      const result = computeSpawnSize({
        topId: 'session-test-top',
        measured: { cols: 100, rows: null }
      })

      // Should fall back to bootstrap since rows is null
      expect(bestBootstrapSize).toHaveBeenCalled()
      expect(result).toEqual({
        cols: 118, // 120 - 2 from bootstrap
        rows: 40
      })
    })

    it('handles partial measured size (missing cols)', () => {
      const result = computeSpawnSize({
        topId: 'session-test-top',
        measured: { cols: null, rows: 40 }
      })

      // Should fall back to bootstrap since cols is null
      expect(bestBootstrapSize).toHaveBeenCalled()
      expect(result).toEqual({
        cols: 118, // 120 - 2 from bootstrap
        rows: 40
      })
    })
  })

  describe('startSessionTop', () => {
    beforeEach(() => {
      vi.mocked(hasInflight).mockReturnValue(false)
      vi.mocked(singleflight).mockImplementation(async (_, fn) => fn())
      vi.mocked(bestBootstrapSize).mockReturnValue({ cols: 120, rows: 40 })
    })

    it('skips start if already inflight', async () => {
      vi.mocked(hasInflight).mockReturnValue(true)

      await startSessionTop({
        sessionName: 'test-session',
        topId: 'session-test-top'
      })

      expect(markBackgroundStart).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
    })

    it('marks background start before invoking', async () => {
      await startSessionTop({
        sessionName: 'test-session',
        topId: 'session-test-top'
      })

      expect(markBackgroundStart).toHaveBeenCalledWith('session-test-top')
      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaude, {
        sessionName: 'test-session',
        cols: 118, // 120 - 2
        rows: 40
      })
    })

    it('uses measured size when provided', async () => {
      await startSessionTop({
        sessionName: 'test-session',
        topId: 'session-test-top',
        measured: { cols: 140, rows: 50 }
      })

      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaude, {
        sessionName: 'test-session',
        cols: 138, // 140 - 2
        rows: 50
      })
    })

    it('passes projectOrchestratorId to size computation', async () => {
      const orchestratorId = 'orchestrator-test-123456-top'

      await startSessionTop({
        sessionName: 'test-session',
        topId: 'session-test-top',
        projectOrchestratorId: orchestratorId
      })

      expect(bestBootstrapSize).toHaveBeenCalledWith({
        topId: 'session-test-top',
        projectOrchestratorId: orchestratorId
      })
    })

    it('cleans up background start mark on error', async () => {
      const error = new Error('Start failed')
      vi.mocked(singleflight).mockRejectedValue(error)

      await expect(startSessionTop({
        sessionName: 'test-session',
        topId: 'session-test-top'
      })).rejects.toThrow('Start failed')

      expect(clearBackgroundStarts).toHaveBeenCalledWith(['session-test-top'])
    })

    it('continues to throw error after cleanup', async () => {
      const error = new Error('Start failed')
      vi.mocked(singleflight).mockRejectedValue(error)

      await expect(startSessionTop({
        sessionName: 'test-session',
        topId: 'session-test-top'
      })).rejects.toThrow('Start failed')
    })

    it('ignores cleanup errors during error handling', async () => {
      const startError = new Error('Start failed')
      const cleanupError = new Error('Cleanup failed')
      vi.mocked(singleflight).mockRejectedValue(startError)
      vi.mocked(clearBackgroundStarts).mockImplementation(() => {
        throw cleanupError
      })

      // Should still throw the original error, not the cleanup error
      await expect(startSessionTop({
        sessionName: 'test-session',
        topId: 'session-test-top'
      })).rejects.toThrow('Start failed')
    })
  })

  describe('startOrchestratorTop', () => {
    beforeEach(() => {
      vi.mocked(hasInflight).mockReturnValue(false)
      vi.mocked(singleflight).mockImplementation(async (_, fn) => fn())
      vi.mocked(bestBootstrapSize).mockReturnValue({ cols: 120, rows: 40 })
    })

    it('skips start if already inflight', async () => {
      vi.mocked(hasInflight).mockReturnValue(true)

      await startOrchestratorTop({
        terminalId: 'orchestrator-test-top'
      })

      expect(markBackgroundStart).not.toHaveBeenCalled()
      expect(invoke).not.toHaveBeenCalled()
    })

    it('invokes orchestrator start command', async () => {
      await startOrchestratorTop({
        terminalId: 'orchestrator-test-top'
      })

      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, {
        terminalId: 'orchestrator-test-top',
        cols: 118, // 120 - 2
        rows: 40
      })
    })

    it('applies guard columns to measured size', async () => {
      await startOrchestratorTop({
        terminalId: 'orchestrator-test-top',
        measured: { cols: 160, rows: 60 }
      })

      expect(invoke).toHaveBeenCalledWith(TauriCommands.SchaltwerkCoreStartClaudeOrchestrator, {
        terminalId: 'orchestrator-test-top',
        cols: 158, // 160 - 2
        rows: 60
      })
    })

    it('cleans up background start mark on error', async () => {
      const error = new Error('Orchestrator start failed')
      vi.mocked(singleflight).mockRejectedValue(error)

      await expect(startOrchestratorTop({
        terminalId: 'orchestrator-test-top'
      })).rejects.toThrow('Orchestrator start failed')

      expect(clearBackgroundStarts).toHaveBeenCalledWith(['orchestrator-test-top'])
    })
  })

  describe('RIGHT_EDGE_GUARD_COLUMNS constant', () => {
    it('has expected value', () => {
      expect(RIGHT_EDGE_GUARD_COLUMNS).toBe(2)
    })

    it('is used consistently in computeSpawnSize', () => {
      const result = computeSpawnSize({
        topId: 'test',
        measured: { cols: 100, rows: 30 }
      })

      expect(result.cols).toBe(100 - RIGHT_EDGE_GUARD_COLUMNS)
    })
  })
})