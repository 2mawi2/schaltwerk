import { describe, it, expect, vi, beforeEach } from 'vitest'
import { 
  groupSessionsByVersion, 
  parseVersionFromSessionName, 
  getBaseSessionName,
  selectBestVersionAndCleanup,
  type EnrichedSession 
} from './sessionVersions'

// Mock session data helper
const createMockSession = (sessionId: string, displayName?: string): EnrichedSession => ({
  info: {
    session_id: sessionId,
    display_name: displayName,
    branch: `branch-${sessionId}`,
    worktree_path: `/path/${sessionId}`,
    base_branch: 'main',
    status: 'active',
    created_at: '2023-01-01T00:00:00Z',
    last_modified: '2023-01-01T01:00:00Z',
    has_uncommitted_changes: false,
    is_current: false,
    session_type: 'worktree',
    session_state: 'running'
  },
  terminals: []
})

describe('sessionVersions', () => {
  describe('parseVersionFromSessionName', () => {
    it('should return null for sessions without version suffix', () => {
      expect(parseVersionFromSessionName('my_session')).toBeNull()
      expect(parseVersionFromSessionName('another-session')).toBeNull()
      expect(parseVersionFromSessionName('session_with_underscores')).toBeNull()
    })

    it('should parse version number from session names with _v suffix', () => {
      expect(parseVersionFromSessionName('my_session_v2')).toBe(2)
      expect(parseVersionFromSessionName('my_session_v3')).toBe(3)
      expect(parseVersionFromSessionName('my_session_v4')).toBe(4)
    })

    it('should return null for invalid version formats', () => {
      expect(parseVersionFromSessionName('my_session_v0')).toBeNull()
      expect(parseVersionFromSessionName('my_session_v5')).toBeNull() // > 4
      expect(parseVersionFromSessionName('my_session_vabc')).toBeNull()
      expect(parseVersionFromSessionName('my_session_v')).toBeNull()
    })
  })

  describe('getBaseSessionName', () => {
    it('should return the same name for sessions without version suffix', () => {
      expect(getBaseSessionName('my_session')).toBe('my_session')
      expect(getBaseSessionName('feature-work')).toBe('feature-work')
    })

    it('should return base name for sessions with version suffix', () => {
      expect(getBaseSessionName('my_session_v2')).toBe('my_session')
      expect(getBaseSessionName('feature-work_v3')).toBe('feature-work')
      expect(getBaseSessionName('complex_name_here_v4')).toBe('complex_name_here')
    })
  })

  describe('groupSessionsByVersion', () => {
    it('should create single-session groups for sessions without versions', () => {
      const sessions = [
        createMockSession('session_a'),
        createMockSession('session_b')
      ]

      const groups = groupSessionsByVersion(sessions)

      expect(groups).toHaveLength(2)
      expect(groups[0].baseName).toBe('session_a')
      expect(groups[0].versions).toHaveLength(1)
      expect(groups[0].isVersionGroup).toBe(false)
      expect(groups[1].baseName).toBe('session_b')
      expect(groups[1].versions).toHaveLength(1)
      expect(groups[1].isVersionGroup).toBe(false)
    })

    it('should group sessions by their base name', () => {
      const sessions = [
        createMockSession('feature_work'),
        createMockSession('feature_work_v2'),
        createMockSession('feature_work_v3'),
        createMockSession('other_session')
      ]

      const groups = groupSessionsByVersion(sessions)

      expect(groups).toHaveLength(2)
      
      const featureGroup = groups.find(g => g.baseName === 'feature_work')
      expect(featureGroup).toBeDefined()
      expect(featureGroup!.isVersionGroup).toBe(true)
      expect(featureGroup!.versions).toHaveLength(3)
      expect(featureGroup!.versions.map(v => v.session.info.session_id)).toEqual([
        'feature_work', 'feature_work_v2', 'feature_work_v3'
      ])

      const otherGroup = groups.find(g => g.baseName === 'other_session')
      expect(otherGroup).toBeDefined()
      expect(otherGroup!.isVersionGroup).toBe(false)
      expect(otherGroup!.versions).toHaveLength(1)
    })

    it('should sort versions correctly (v1, v2, v3, v4)', () => {
      const sessions = [
        createMockSession('test_v3'),
        createMockSession('test'),
        createMockSession('test_v4'),
        createMockSession('test_v2')
      ]

      const groups = groupSessionsByVersion(sessions)
      const testGroup = groups.find(g => g.baseName === 'test')

      expect(testGroup!.versions.map(v => v.versionNumber)).toEqual([1, 2, 3, 4])
      expect(testGroup!.versions.map(v => v.session.info.session_id)).toEqual([
        'test', 'test_v2', 'test_v3', 'test_v4'
      ])
    })

    it('should handle mixed session patterns correctly', () => {
      const sessions = [
        createMockSession('feature_a'),
        createMockSession('feature_a_v2'),
        createMockSession('standalone'),
        createMockSession('feature_b'),
        createMockSession('feature_b_v2'),
        createMockSession('feature_b_v3')
      ]

      const groups = groupSessionsByVersion(sessions)

      expect(groups).toHaveLength(3)
      expect(groups.filter(g => g.isVersionGroup)).toHaveLength(2)
      expect(groups.filter(g => !g.isVersionGroup)).toHaveLength(1)
      
      const standaloneGroup = groups.find(g => g.baseName === 'standalone')
      expect(standaloneGroup!.isVersionGroup).toBe(false)
    })

    it('should preserve session order within groups', () => {
      const sessions = [
        createMockSession('test_v2'),
        createMockSession('test'),
        createMockSession('test_v4'),
        createMockSession('test_v3')
      ]

      const groups = groupSessionsByVersion(sessions)
      const testGroup = groups[0]

      // Versions should be sorted regardless of input order
      expect(testGroup.versions.map(v => v.versionNumber)).toEqual([1, 2, 3, 4])
    })

    it('should handle empty session list', () => {
      const groups = groupSessionsByVersion([])
      expect(groups).toHaveLength(0)
    })
  })

  describe('selectBestVersionAndCleanup', () => {
    // Mock functions for invoke
    const mockInvoke = vi.fn()
    const mockReloadSessions = vi.fn()

    beforeEach(() => {
      vi.clearAllMocks()
      mockInvoke.mockResolvedValue(undefined)
      mockReloadSessions.mockResolvedValue(undefined)
    })

    it('should throw error for non-version-group sessions', async () => {
      const sessions = [createMockSession('single_session')]
      const groups = groupSessionsByVersion(sessions)
      const singleGroup = groups[0]

      await expect(
        selectBestVersionAndCleanup(singleGroup, 'single_session', mockInvoke, mockReloadSessions)
      ).rejects.toThrow('Cannot select best version from a non-version group')
    })

    it('should throw error for non-existent version in group', async () => {
      const sessions = [
        createMockSession('test'),
        createMockSession('test_v2'),
        createMockSession('test_v3')
      ]
      const groups = groupSessionsByVersion(sessions)
      const testGroup = groups[0]

      await expect(
        selectBestVersionAndCleanup(testGroup, 'nonexistent', mockInvoke, mockReloadSessions)
      ).rejects.toThrow('Selected session not found in version group')
    })

    it('should cancel non-selected versions when v1 (base) is selected', async () => {
      const sessions = [
        createMockSession('feature'),
        createMockSession('feature_v2'),
        createMockSession('feature_v3')
      ]
      const groups = groupSessionsByVersion(sessions)
      const featureGroup = groups[0]

      await selectBestVersionAndCleanup(featureGroup, 'feature', mockInvoke, mockReloadSessions)

      // Should cancel v2 and v3, but not the selected base version
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v2' })
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v3' })
      expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature' })
      expect(mockInvoke).toHaveBeenCalledTimes(2)
      expect(mockReloadSessions).toHaveBeenCalledTimes(1)
    })

    it('should cancel all other versions except the selected one', async () => {
      const sessions = [
        createMockSession('feature_v1'),
        createMockSession('feature_v2'),
        createMockSession('feature_v3'),
        createMockSession('feature_v4')
      ]
      const groups = groupSessionsByVersion(sessions)
      const featureGroup = groups[0]

      mockInvoke.mockResolvedValue(undefined) // For cancel calls

      await selectBestVersionAndCleanup(featureGroup, 'feature_v3', mockInvoke, mockReloadSessions)

      // Should cancel all versions except the selected one (feature_v3)
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v1' })
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v2' })
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v4' })
      
      // Should NOT cancel the selected version
      expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v3' })
      
      expect(mockInvoke).toHaveBeenCalledTimes(3) // 3 cancellations
      expect(mockReloadSessions).toHaveBeenCalledTimes(1)
    })

    it('should handle errors gracefully when cancellation fails', async () => {
      const sessions = [
        createMockSession('test'),
        createMockSession('test_v2')
      ]
      const groups = groupSessionsByVersion(sessions)
      const testGroup = groups[0]

      mockInvoke.mockRejectedValueOnce(new Error('Cancel failed'))
        .mockResolvedValueOnce(undefined) // For the second cancel call

      await expect(
        selectBestVersionAndCleanup(testGroup, 'test', mockInvoke, mockReloadSessions)
      ).rejects.toThrow('Failed to cleanup session versions')

      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'test_v2' })
      expect(mockReloadSessions).not.toHaveBeenCalled() // Should not reload on error
    })

    it('should handle cancellation failure gracefully', async () => {
      const sessions = [
        createMockSession('test_v1'),
        createMockSession('test_v2')
      ]
      const groups = groupSessionsByVersion(sessions)
      const testGroup = groups[0]

      // Reset mocks to ensure clean state
      mockInvoke.mockReset()
      mockInvoke.mockRejectedValueOnce(new Error('Cancel failed')) // cancel_session fails

      await expect(
        selectBestVersionAndCleanup(testGroup, 'test_v2', mockInvoke, mockReloadSessions)
      ).rejects.toThrow('Failed to cleanup session versions')

      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'test_v1' })
      expect(mockReloadSessions).not.toHaveBeenCalled()
    })

    it('should work with only two versions', async () => {
      const sessions = [
        createMockSession('simple'),
        createMockSession('simple_v2')
      ]
      const groups = groupSessionsByVersion(sessions)
      const simpleGroup = groups[0]

      // Reset mocks to ensure clean state
      mockInvoke.mockReset()
      mockReloadSessions.mockReset()
      mockInvoke.mockResolvedValueOnce({ base_branch: 'main' }) // get_session
      mockInvoke.mockResolvedValue(undefined) // create and cancel calls
      mockReloadSessions.mockResolvedValue(undefined)

      await selectBestVersionAndCleanup(simpleGroup, 'simple_v2', mockInvoke, mockReloadSessions)

      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'simple' })
      expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'simple_v2' })
      expect(mockInvoke).toHaveBeenCalledTimes(1) // 1 cancellation
      expect(mockReloadSessions).toHaveBeenCalledTimes(1)
    })

    it('should keep selected version with its current name when it has a suffix', async () => {
      const sessions = [
        createMockSession('feature'),
        createMockSession('feature_v2'),
        createMockSession('feature_v3')
      ]
      const groups = groupSessionsByVersion(sessions)
      const featureGroup = groups[0]

      // Reset mocks to ensure clean state
      mockInvoke.mockReset()
      mockReloadSessions.mockReset()
      mockInvoke.mockResolvedValue(undefined)
      mockReloadSessions.mockResolvedValue(undefined)

      await selectBestVersionAndCleanup(featureGroup, 'feature_v2', mockInvoke, mockReloadSessions)

      // The selected version (feature_v2) should be kept with its current name
      // since renaming running sessions is not supported by the backend
      expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_create_session', 
        expect.objectContaining({
          name: 'feature'
        })
      )
      
      // Should cancel all other versions except the selected one
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature' })
      expect(mockInvoke).not.toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v2' })
      expect(mockInvoke).toHaveBeenCalledWith('schaltwerk_core_cancel_session', { name: 'feature_v3' })
      
      expect(mockInvoke).toHaveBeenCalledTimes(2) // Only 2 cancellations (feature and feature_v3)
      expect(mockReloadSessions).toHaveBeenCalledTimes(1)
    })
  })
})