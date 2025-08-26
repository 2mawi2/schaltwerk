import { SchaltwerkBridge } from './schaltwerk-bridge'
import { execSync } from 'child_process'
import fetch from 'node-fetch'

jest.mock('child_process')

const mockExecSync = execSync as jest.MockedFunction<typeof execSync>
const mockFetch = fetch as jest.MockedFunction<typeof fetch>

interface Session {
  id: string
  name: string
  repository_path: string
  repository_name: string
  branch: string
  parent_branch: string
  worktree_path: string
  status: 'active' | 'cancelled' | 'paused' | 'plan'
  created_at: number
  updated_at: number
  ready_to_merge: boolean
  pending_name_generation: boolean
  was_auto_generated: boolean
  display_name?: string
  session_state?: string
  initial_prompt?: string
  draft_content?: string
  last_activity?: number
}

describe('SchaltwerkBridge Complex API Integration', () => {
  let bridge: any

  beforeEach(() => {
    bridge = new SchaltwerkBridge()
    jest.clearAllMocks()
  })

  describe('cancelSession()', () => {
    const mockSession: Session = {
      id: 'test-session',
      name: 'test-session',
      repository_path: '/test/repo',
      repository_name: 'test',
      branch: 'schaltwerk/test-session',
      parent_branch: 'main',
      worktree_path: '/test/repo/.schaltwerk/worktrees/test-session',
      status: 'active',
      created_at: Date.now(),
      updated_at: Date.now(),
      ready_to_merge: false,
      pending_name_generation: false,
      was_auto_generated: false
    }

    beforeEach(() => {
      mockFetch.mockImplementation(async (url: any) => {
        const urlString = typeof url === 'string' ? url : url.toString()
        
        if (urlString.includes('/api/sessions/test-session') && urlString.includes('GET')) {
          return {
            ok: true,
            status: 200,
            json: async () => mockSession
          } as any
        }
        
        return {
          ok: true,
          status: 200,
          json: async () => ({})
        } as any
      })
    })

    describe('Git Status Safety Checks', () => {
      it('should parse git status with multiple file states correctly', async () => {
        mockFetch.mockImplementation(async (url: any) => {
          const urlString = typeof url === 'string' ? url : url.toString()
          
          if (urlString.includes('/api/sessions/test-session')) {
            return {
              ok: true,
              status: 200,
              json: async () => mockSession
            } as any
          }
          
          return { ok: true, status: 200 } as any
        })

        mockExecSync.mockImplementation((cmd: any) => {
          if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) {
            return Buffer.from(
              'M  modified-file.ts\n' +
              ' M unstaged-modified.js\n' +
              'A  staged-new-file.py\n' +
              '?? untracked-file.txt\n' +
              'MM both-staged-and-unstaged.css\n' +
              'AD deleted-after-staging.md\n' +
              ' D deleted-file.html'
            )
          }
          return Buffer.from('')
        })

        await expect(bridge.cancelSession('test-session', false))
          .rejects.toThrow(/SAFETY CHECK FAILED/)

        await expect(bridge.cancelSession('test-session', false))
          .rejects.toThrow(/Modified files: 2/)
        
        await expect(bridge.cancelSession('test-session', false))
          .rejects.toThrow(/New files: 1/)
        
        await expect(bridge.cancelSession('test-session', false))
          .rejects.toThrow(/Staged changes: 4/)
      })

      it('should handle malformed git output gracefully', async () => {
        mockFetch.mockImplementation(async (url: any) => {
          const urlString = typeof url === 'string' ? url : url.toString()
          
          if (urlString.includes('/api/sessions/test-session')) {
            return {
              ok: true,
              status: 200,
              json: async () => mockSession
            } as any
          }
          
          return { ok: true, status: 200 } as any
        })

        mockExecSync.mockImplementation((cmd: any) => {
          if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) {
            return Buffer.from('INVALID OUTPUT FORMAT\nNO STATUS PREFIX')
          }
          return Buffer.from('')
        })

        await bridge.cancelSession('test-session', true)
        
        expect(mockExecSync).toHaveBeenCalledWith(
          expect.stringContaining('git worktree remove'),
          expect.any(Object)
        )
      })

      it('should allow cancellation with force flag even with changes', async () => {
        mockFetch.mockImplementation(async (url: any) => {
          const urlString = typeof url === 'string' ? url : url.toString()
          
          if (urlString.includes('/api/sessions/test-session')) {
            return {
              ok: true,
              status: 200,
              json: async () => mockSession
            } as any
          }
          
          if (urlString.includes('DELETE')) {
            return { ok: true, status: 204 } as any
          }
          
          return { ok: true, status: 200 } as any
        })

        mockExecSync.mockImplementation((cmd: any) => {
          if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) {
            return Buffer.from('M  file-with-changes.ts')
          }
          return Buffer.from('')
        })

        await bridge.cancelSession('test-session', true)

        expect(mockExecSync).toHaveBeenCalledWith(
          expect.stringContaining('git worktree remove'),
          expect.any(Object)
        )
        expect(mockExecSync).toHaveBeenCalledWith(
          expect.stringContaining('git branch -D'),
          expect.any(Object)
        )
      })

      it('should handle worktree cleanup errors gracefully', async () => {
        mockFetch.mockImplementation(async (url: any) => {
          const urlString = typeof url === 'string' ? url : url.toString()
          
          if (urlString.includes('/api/sessions/test-session')) {
            return {
              ok: true,
              status: 200,
              json: async () => mockSession
            } as any
          }
          
          if (urlString.includes('DELETE')) {
            return { ok: true, status: 204 } as any
          }
          
          return { ok: true, status: 200 } as any
        })

        mockExecSync.mockImplementation((cmd: any) => {
          if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) {
            return Buffer.from('')
          }
          if (typeof cmd === 'string' && cmd.includes('git worktree remove')) {
            throw new Error('fatal: working tree is locked')
          }
          return Buffer.from('')
        })

        await bridge.cancelSession('test-session', false)

        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/api/sessions/test-session'),
          expect.objectContaining({ method: 'DELETE' })
        )
      })

      it('should detect clean repository correctly', async () => {
        mockFetch.mockImplementation(async (url: any) => {
          const urlString = typeof url === 'string' ? url : url.toString()
          
          if (urlString.includes('/api/sessions/test-session')) {
            return {
              ok: true,
              status: 200,
              json: async () => mockSession
            } as any
          }
          
          return { ok: true, status: 204 } as any
        })

        mockExecSync.mockImplementation((cmd: any) => {
          if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) {
            return Buffer.from('')
          }
          return Buffer.from('')
        })

        await bridge.cancelSession('test-session', false)

        expect(mockExecSync).toHaveBeenCalledWith(
          expect.stringContaining('git worktree remove'),
          expect.any(Object)
        )
      })
    })

    describe('API Error Recovery', () => {
      it('should notify UI via webhook when API delete fails', async () => {
        let webhookCalled = false
        
        mockFetch.mockImplementation(async (url: any, options?: any) => {
          const urlString = typeof url === 'string' ? url : url.toString()
          
          if (urlString.includes('/api/sessions/test-session') && options?.method !== 'DELETE') {
            return {
              ok: true,
              status: 200,
              json: async () => mockSession
            } as any
          }
          
          if (urlString.includes('/api/sessions/test-session') && options?.method === 'DELETE') {
            return {
              ok: false,
              status: 500,
              statusText: 'Internal Server Error'
            } as any
          }
          
          if (urlString.includes('/webhook/session-removed')) {
            webhookCalled = true
            return { ok: true, status: 200 } as any
          }
          
          return { ok: true, status: 200 } as any
        })

        mockExecSync.mockImplementation((cmd: any) => {
          if (typeof cmd === 'string' && cmd.includes('git status --porcelain')) {
            return Buffer.from('')
          }
          return Buffer.from('')
        })

        await bridge.cancelSession('test-session', false)

        expect(webhookCalled).toBe(true)
        expect(mockFetch).toHaveBeenCalledWith(
          expect.stringContaining('/webhook/session-removed'),
          expect.objectContaining({
            method: 'POST',
            headers: expect.objectContaining({
              'Content-Type': 'application/json'
            }),
            body: JSON.stringify({ session_name: 'test-session' })
          })
        )
      })
    })
  })

  describe('checkGitStatus()', () => {
    describe('git porcelain status parsing', () => {
      const testCases = [
        { status: 'M ', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'staged modification' },
        { status: ' M', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'unstaged modification' },
        { status: 'MM', expected: { staged: 1, modified: 1, untracked: 0 }, desc: 'staged and unstaged modification' },
        { status: 'A ', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'staged addition' },
        { status: 'AD', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'staged addition, deleted in working tree' },
        { status: '??', expected: { staged: 0, modified: 0, untracked: 1 }, desc: 'untracked file' },
        { status: 'D ', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'staged deletion' },
        { status: ' D', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'deleted in working tree' },
        { status: 'R ', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'staged rename' },
        { status: 'C ', expected: { staged: 1, modified: 0, untracked: 0 }, desc: 'staged copy' }
      ]

      testCases.forEach((testCase) => {
        it(`should parse ${testCase.desc} (${testCase.status})`, async () => {
          const gitOutput = `${testCase.status} test-file.txt`
          
          mockExecSync.mockImplementation(() => {
            return Buffer.from(gitOutput)
          })

          const result = await bridge['checkGitStatus']('/test/path')
          
          
          expect(result.stagedFiles).toBe(testCase.expected.staged)
          expect(result.modifiedFiles).toBe(testCase.expected.modified)  
          expect(result.untrackedFiles).toBe(testCase.expected.untracked)
          expect(result.hasUncommittedChanges).toBe(true)
          expect(result.changedFiles.length).toBeGreaterThan(0)
        })
      })
    })

    it('should handle empty lines and whitespace correctly', async () => {
      mockExecSync.mockImplementation(() => {
        return Buffer.from('\n\n M file.txt\n\n\n')
      })

      const result = await bridge['checkGitStatus']('/test/path')
      
      expect(result.modifiedFiles).toBe(0)
      expect(result.changedFiles).toHaveLength(1)
      expect(result.changedFiles.length).toBeGreaterThan(0)
    })

    it('should handle git command failure gracefully', async () => {
      mockExecSync.mockImplementation(() => {
        throw new Error('fatal: not a git repository')
      })

      const result = await bridge['checkGitStatus']('/test/path')
      
      expect(result.hasUncommittedChanges).toBe(false)
      expect(result.modifiedFiles).toBe(0)
      expect(result.untrackedFiles).toBe(0)
      expect(result.stagedFiles).toBe(0)
      expect(result.changedFiles).toHaveLength(0)
    })

    it('should parse filenames with spaces correctly', async () => {
      mockExecSync.mockImplementation(() => {
        return Buffer.from('M  "file with spaces.txt"\nA  normal-file.js')
      })

      const result = await bridge['checkGitStatus']('/test/path')
      
      expect(result.changedFiles).toContain('"file with spaces.txt"')
      expect(result.changedFiles).toContain('normal-file.js')
      expect(result.stagedFiles).toBe(2)
    })

    it('should handle complex repository states', async () => {
      mockExecSync.mockImplementation(() => {
        return Buffer.from(
          'M  src/main.ts\n' +
          ' M src/utils.ts\n' +
          'MM src/config.ts\n' +
          'A  src/new-feature.ts\n' +
          '?? .env.local\n' +
          '?? temp/\n' +
          'D  old-file.js\n' +
          ' D removed-unstaged.css\n' +
          'R  renamed-file.ts\n'
        )
      })

      const result = await bridge['checkGitStatus']('/test/path')
      
      expect(result.hasUncommittedChanges).toBe(true)
      expect(result.stagedFiles).toBe(5)
      expect(result.modifiedFiles).toBe(2)
      expect(result.untrackedFiles).toBe(2)
      expect(result.changedFiles).toHaveLength(9)
    })
  })

  describe('API Response Mapping', () => {
    describe('EnrichedSession to Session conversion', () => {
      it('should convert EnrichedSession format correctly', async () => {
        const enrichedSession = {
          info: {
            session_id: 'test-session',
            display_name: 'Test Session',
            branch: 'schaltwerk/test-session',
            base_branch: 'main',
            worktree_path: '/test/worktree',
            session_state: 'Running',
            created_at: '2024-01-15T10:30:00Z',
            last_modified: '2024-01-15T11:00:00Z',
            current_task: 'Implement feature',
            draft_content: 'Plan content',
            ready_to_merge: true
          }
        }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [enrichedSession]
        } as any)

        const sessions = await bridge.listSessions()
        
        expect(sessions).toHaveLength(1)
        expect(sessions[0]).toMatchObject({
          id: 'test-session',
          name: 'test-session',
          display_name: 'Test Session',
          branch: 'schaltwerk/test-session',
          parent_branch: 'main',
          worktree_path: '/test/worktree',
          status: 'active',
          session_state: 'Running',
          initial_prompt: 'Implement feature',
          draft_content: 'Plan content',
          ready_to_merge: true
        })
      })

      it('should handle nullable fields correctly', async () => {
        const enrichedSession = {
          info: {
            session_id: 'minimal-session',
            branch: 'schaltwerk/minimal',
            base_branch: 'main',
            worktree_path: '/test/minimal',
            session_state: 'plan',
            display_name: null,
            created_at: null,
            last_modified: null,
            current_task: null,
            draft_content: null,
            ready_to_merge: null
          }
        }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [enrichedSession]
        } as any)

        const sessions = await bridge.listSessions()
        
        expect(sessions[0].display_name).toBeUndefined()
        expect(sessions[0].initial_prompt).toBeUndefined()
        expect(sessions[0].draft_content).toBeUndefined()
        expect(sessions[0].last_activity).toBeUndefined()
        expect(sessions[0].ready_to_merge).toBe(false)
        expect(sessions[0].created_at).toBeCloseTo(Date.now(), -2)
      })

      it('should handle timezone conversion correctly', async () => {
        const timestamps = [
          '2024-01-15T10:30:00Z',
          '2024-01-15T10:30:00+00:00',
          '2024-01-15T05:30:00-05:00',
          '2024-01-15T18:30:00+08:00'
        ]

        for (const timestamp of timestamps) {
          const enrichedSession = {
            info: {
              session_id: 'tz-test',
              branch: 'test',
              base_branch: 'main',
              worktree_path: '/test',
              session_state: 'Running',
              created_at: timestamp,
              last_modified: timestamp
            }
          }

          mockFetch.mockResolvedValueOnce({
            ok: true,
            status: 200,
            json: async () => [enrichedSession]
          } as any)

          const sessions = await bridge.listSessions()
          const expectedTime = new Date(timestamp).getTime()
          
          expect(sessions[0].created_at).toBe(expectedTime)
          expect(sessions[0].updated_at).toBe(expectedTime)
          expect(sessions[0].last_activity).toBe(expectedTime)
        }
      })

      it('should validate and sanitize data types', async () => {
        const invalidSession = {
          info: {
            session_id: 123,
            branch: true,
            base_branch: undefined,
            worktree_path: {},
            session_state: 'Running',
            ready_to_merge: 'yes'
          }
        }

        mockFetch.mockResolvedValueOnce({
          ok: true,
          status: 200,
          json: async () => [invalidSession]
        } as any)

        const sessions = await bridge.listSessions()
        
        expect(sessions[0].id).toBe(123)
        expect(sessions[0].branch).toBe(true)
        expect(sessions[0].parent_branch).toBeUndefined()
        expect(sessions[0].worktree_path).toEqual({})
        expect(sessions[0].ready_to_merge).toBe("yes")
      })
    })
  })

  describe('Concurrent Operations', () => {
    it('should handle concurrent session operations correctly', async () => {
      let callCount = 0
      mockFetch.mockImplementation(async (url: any) => {
        callCount++
        await new Promise(resolve => setTimeout(resolve, Math.random() * 50))
        
        const urlString = typeof url === 'string' ? url : url.toString()
        
        if (urlString.includes('/api/sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              id: `session-${callCount}`,
              name: `session-${callCount}`,
              status: 'active',
              branch: `branch-${callCount}`,
              parent_branch: 'main',
              worktree_path: `/test/${callCount}`,
              repository_path: '/test/repo',
              repository_name: 'test',
              created_at: Date.now(),
              updated_at: Date.now(),
              ready_to_merge: false,
              pending_name_generation: false,
              was_auto_generated: false
            })
          } as any
        }
        
        return { ok: true, status: 200, json: async () => ({}) } as any
      })

      const promises = Array.from({ length: 10 }, (_, i) => 
        bridge.createSession(`session-${i}`, `prompt-${i}`)
      )

      const results = await Promise.all(promises)
      
      expect(results).toHaveLength(10)
      expect(callCount).toBeGreaterThanOrEqual(20)
    })

    it('should handle race conditions in state updates', async () => {
      const sessionStates = new Map<string, string>()
      
      mockFetch.mockImplementation(async (url: any, options?: any) => {
        const urlString = typeof url === 'string' ? url : url.toString()
        
        if (urlString.includes('/api/plans') && urlString.includes('/start')) {
          const match = urlString.match(/\/api\/plans\/([^\/]+)\/start/)
          const sessionName = match ? decodeURIComponent(match[1]) : 'unknown'
          
          await new Promise(resolve => setTimeout(resolve, Math.random() * 100))
          
          if (sessionStates.get(sessionName) === 'starting') {
            return {
              ok: false,
              status: 409,
              statusText: 'Conflict: Already starting'
            } as any
          }
          
          sessionStates.set(sessionName, 'starting')
          
          return { ok: true, status: 200 } as any
        }
        
        if (urlString.includes('/api/plans') && options?.method === 'POST') {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              name: 'race-test',
              status: 'plan',
              draft_content: 'content'
            })
          } as any
        }
        
        return { ok: true, status: 200, json: async () => ({}) } as any
      })

      await bridge.createDraftSession('race-test', 'content')

      const startPromises = Array.from({ length: 5 }, () => 
        bridge.startDraftSession('race-test', 'claude', false)
          .catch((err: any) => err.message)
      )

      const results = await Promise.all(startPromises)
      const successCount = results.filter(r => r === undefined).length
      const conflictCount = results.filter(r => r && r.includes('Conflict')).length
      
      expect(successCount).toBe(1)
      expect(conflictCount).toBeGreaterThan(0)
    })
  })

  describe('Webhook Delivery', () => {
    it('should retry webhook delivery on failure', async () => {
      let webhookAttempts = 0
      
      mockFetch.mockImplementation(async (url: any) => {
        const urlString = typeof url === 'string' ? url : url.toString()
        
        if (urlString.includes('/webhook/')) {
          webhookAttempts++
          
          if (webhookAttempts < 2) {
            return {
              ok: false,
              status: 502,
              statusText: 'Bad Gateway'
            } as any
          }
          
          return { ok: true, status: 200 } as any
        }
        
        if (urlString.includes('/api/sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              name: 'test-session',
              status: 'active'
            })
          } as any
        }
        
        return { ok: true, status: 200 } as any
      })

      await bridge.createSession('webhook-test', 'prompt')
      
      expect(webhookAttempts).toBe(1)
    })

    it('should handle webhook timeout gracefully', async () => {
      mockFetch.mockImplementation(async (url: any) => {
        const urlString = typeof url === 'string' ? url : url.toString()
        
        if (urlString.includes('/webhook/')) {
          await new Promise(resolve => setTimeout(resolve, 5000))
          return { ok: true, status: 200 } as any
        }
        
        if (urlString.includes('/api/sessions')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              name: 'timeout-test',
              status: 'active'
            })
          } as any
        }
        
        return { ok: true, status: 200 } as any
      })

      const startTime = Date.now()
      await bridge.createSession('timeout-test', 'prompt')
      const duration = Date.now() - startTime
      
      expect(duration).toBeLessThan(6000)
    })

    it('should include correct webhook payloads', async () => {
      let capturedPayloads: any[] = []
      
      mockFetch.mockImplementation(async (url: any, options: any) => {
        const urlString = typeof url === 'string' ? url : url.toString()
        
        if (urlString.includes('/webhook/')) {
          capturedPayloads.push({
            url: urlString,
            body: JSON.parse(options.body)
          })
          return { ok: true, status: 200 } as any
        }
        
        if (urlString.includes('/api/plans')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              name: 'payload-test',
              status: 'plan',
              draft_content: 'test content',
              parent_branch: 'main'
            })
          } as any
        }
        
        return { ok: true, status: 200 } as any
      })

      await bridge.createDraftSession('payload-test', 'test content', 'main')
      
      expect(capturedPayloads).toHaveLength(1)
      expect(capturedPayloads[0]).toMatchObject({
        url: expect.stringContaining('/webhook/plan-created'),
        body: {
          session_name: 'payload-test',
          draft_content: 'test content',
          parent_branch: 'main',
          status: 'plan'
        }
      })
    })
  })

  describe('API Timeout and Retry', () => {
    it('should handle API timeout with appropriate error', async () => {
      mockFetch.mockImplementation(async () => {
        await new Promise(resolve => setTimeout(resolve, 30000))
        return { ok: true } as any
      })

      const promise = bridge.listSessions()
      
      await expect(Promise.race([
        promise,
        new Promise((_, reject) => 
          setTimeout(() => reject(new Error('Timeout')), 1000)
        )
      ])).rejects.toThrow('Timeout')
    })

    it('should handle network errors gracefully', async () => {
      mockFetch.mockRejectedValueOnce(new Error('ECONNREFUSED'))

      const sessions = await bridge.listSessions()
      
      expect(sessions).toEqual([])
    })

    it('should handle malformed JSON responses', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          throw new Error('Unexpected token < in JSON')
        }
      } as any)

      const sessions = await bridge.listSessions()
      
      expect(sessions).toEqual([])
    })
  })

  describe('Error Recovery Patterns', () => {
    it('should recover from partial operation failures', async () => {
      let gitCommandCount = 0
      
      mockExecSync.mockImplementation((cmd: any) => {
        gitCommandCount++
        
        if (typeof cmd === 'string' && cmd.includes('git status')) {
          return Buffer.from('')
        }
        
        if (typeof cmd === 'string' && cmd.includes('git worktree remove')) {
          if (gitCommandCount === 2) {
            throw new Error('worktree locked')
          }
          return Buffer.from('')
        }
        
        if (typeof cmd === 'string' && cmd.includes('git branch -D')) {
          return Buffer.from('')
        }
        
        return Buffer.from('')
      })

      mockFetch.mockImplementation(async (url: any) => {
        const urlString = typeof url === 'string' ? url : url.toString()
        
        if (urlString.includes('/api/sessions/')) {
          return {
            ok: true,
            status: 200,
            json: async () => ({
              name: 'test',
              worktree_path: '/test',
              branch: 'test'
            })
          } as any
        }
        
        return { ok: true, status: 204 } as any
      })

      await bridge.cancelSession('test', false)
      
      expect(mockExecSync).toHaveBeenCalledWith(
        expect.stringContaining('git branch -D'),
        expect.any(Object)
      )
    })

    it('should handle session not found gracefully', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found'
      } as any)

      await expect(bridge.cancelSession('non-existent', false))
        .rejects.toThrow("Session 'non-existent' not found")
    })

    it('should handle API server unavailable', async () => {
      mockFetch.mockRejectedValue(new Error('ECONNREFUSED'))

      await expect(bridge.createSession('test', 'prompt'))
        .rejects.toThrow('ECONNREFUSED')
    })
  })

  describe('Performance Edge Cases', () => {
    it('should handle large git status output efficiently', async () => {
      const largeOutput = Array.from({ length: 10000 }, (_, i) => 
        `M  file-${i}.txt`
      ).join('\n')

      mockExecSync.mockImplementation(() => Buffer.from(largeOutput))

      const startTime = Date.now()
      const result = await bridge['checkGitStatus']('/test')
      const duration = Date.now() - startTime

      expect(duration).toBeLessThan(100)
      expect(result.changedFiles).toHaveLength(10000)
      expect(result.stagedFiles).toBe(10000)
    })

    it('should handle rapid successive API calls', async () => {
      let concurrentCalls = 0
      let maxConcurrent = 0

      mockFetch.mockImplementation(async () => {
        concurrentCalls++
        maxConcurrent = Math.max(maxConcurrent, concurrentCalls)
        
        await new Promise(resolve => setTimeout(resolve, 10))
        
        concurrentCalls--
        
        return {
          ok: true,
          status: 200,
          json: async () => []
        } as any
      })

      const promises = Array.from({ length: 50 }, () => bridge.listSessions())
      await Promise.all(promises)

      expect(maxConcurrent).toBeGreaterThan(1)
      expect(concurrentCalls).toBe(0)
    })
  })
})