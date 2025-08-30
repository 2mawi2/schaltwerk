import { SchaltwerkBridge, Session } from '../src/schaltwerk-bridge'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'
import fetch from 'node-fetch'

describe('MCP API Integration Tests', () => {
  let bridge: SchaltwerkBridge
  let testDbPath: string
  let testRepoPath: string
  const apiUrl = 'http://127.0.0.1:8547'

  beforeAll(async () => {
    testRepoPath = path.join(os.tmpdir(), `test-repo-${Date.now()}`)
    fs.mkdirSync(testRepoPath, { recursive: true })
    execSync('git init', { cwd: testRepoPath })
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath })
    execSync('git config user.name "Test User"', { cwd: testRepoPath })
    execSync('echo "test" > README.md', { cwd: testRepoPath })
    execSync('git add .', { cwd: testRepoPath })
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath })
    
    const dataDir = path.join(os.tmpdir(), `test-schaltwerk-${Date.now()}`)
    const projectDir = path.join(dataDir, 'projects', 'schaltwerk_test')
    fs.mkdirSync(projectDir, { recursive: true })
    testDbPath = path.join(projectDir, 'sessions.db')
    
    bridge = new SchaltwerkBridge()
    ;(bridge as any).dbPath = testDbPath
    bridge['getRepositoryPath'] = async () => testRepoPath
    
    await bridge.connect()
    
    const initSql = `
      CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        display_name TEXT,
        repository_path TEXT NOT NULL,
        repository_name TEXT NOT NULL,
        branch TEXT NOT NULL,
        parent_branch TEXT NOT NULL,
        worktree_path TEXT NOT NULL,
        status TEXT NOT NULL,
        session_state TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        last_activity INTEGER,
        initial_prompt TEXT,
        draft_content TEXT,
        ready_to_merge INTEGER DEFAULT 0,
        original_agent_type TEXT,
        original_skip_permissions INTEGER DEFAULT 0,
        pending_name_generation INTEGER DEFAULT 0,
        was_auto_generated INTEGER DEFAULT 0
      );
      
      CREATE TABLE IF NOT EXISTS app_config (
        id INTEGER PRIMARY KEY,
        agent_type TEXT,
        skip_permissions INTEGER
      );
      
      INSERT INTO app_config (id, agent_type, skip_permissions) VALUES (1, 'claude', 0);
    `
    
    await bridge['db']!.exec(initSql)
  })

  afterAll(async () => {
    await bridge.disconnect()
    if (fs.existsSync(testRepoPath)) {
      execSync(`rm -rf "${testRepoPath}"`)
    }
  })

  describe('Spec Integration', () => {
    test('Create spec via MCP → API → Database', async () => {
      const draftName = `test-spec-${Date.now()}`
      const draftContent = 'Test content for spec'
      
      const spec = await bridge.createSpecSession(draftName, draftContent)
      
      expect(spec.status).toBe('spec')
      expect(spec.draft_content).toBe(draftContent)
      expect(spec.session_state).toBe('Spec')
      expect(spec.name).toBe(draftName)
      
      const retrievedDraft = await bridge.getSession(draftName)
      expect(retrievedDraft).toBeDefined()
      expect(retrievedDraft?.status).toBe('spec')
    })
    
    test('Update spec content', async () => {
      const draftName = `update-test-${Date.now()}`
      await bridge.createSpecSession(draftName, 'initial')
      
      await bridge.updateDraftContent(draftName, 'new', false)
      
      const spec = await bridge.getSession(draftName)
      expect(spec).toBeDefined()
      expect(spec?.draft_content).toBe('new')
    })
    
    test('Append to spec content', async () => {
      const draftName = `append-test-${Date.now()}`
      await bridge.createSpecSession(draftName, 'initial')
      
      await bridge.updateDraftContent(draftName, 'appended', true)
      
      const spec = await bridge.getSession(draftName)
      expect(spec).toBeDefined()
      expect(spec?.draft_content).toBe('initial\nappended')
    })
    
    test('Start spec session transitions to active', async () => {
      const draftName = `start-test-${Date.now()}`
      bridge['createWorktree'] = async () => path.join(testRepoPath, '.schaltwerk', 'worktrees', draftName)
      
      await bridge.createSpecSession(draftName, 'content')
      await bridge.startDraftSession(draftName, 'claude', false)
      
      const session = await bridge.getSession(draftName)
      expect(session).toBeDefined()
      expect(session?.status).toBe('active')
      expect(session?.session_state).toBe('Running')
      expect(session?.initial_prompt).toBe('content')
    })
    
    test('Delete spec session', async () => {
      const draftName = `delete-test-${Date.now()}`
      await bridge.createSpecSession(draftName, 'to delete')
      
      await bridge.deleteDraftSession(draftName)
      
      const session = await bridge.getSession(draftName)
      expect(session).toBeUndefined()
    })
  })

  describe('Session Filtering', () => {
    beforeEach(async () => {
      await bridge['db']!.run('DELETE FROM sessions')
    })

    test('List only spec sessions', async () => {
      await bridge.createSpecSession('draft1', 'content1')
      await bridge.createSpecSession('draft2', 'content2')
      
      bridge['createWorktree'] = async (_, name) => path.join(testRepoPath, '.schaltwerk', 'worktrees', name)
      await bridge.createSession('active1', 'prompt1')
      
      const specs = await bridge.listDraftSessions()
      expect(specs.length).toBe(2)
      expect(specs.every(s => s.status === 'spec')).toBe(true)
      
      const sessions = await bridge.listSessions()
      expect(sessions.length).toBe(1)
      expect(sessions[0].name).toBe('active1')
    })
    
    test('List sessions by state', async () => {
      await bridge.createSpecSession('spec-state', 'spec')
      bridge['createWorktree'] = async (_, name) => path.join(testRepoPath, '.schaltwerk', 'worktrees', name)
      await bridge.createSession('active-state', 'active')
      
      const allSessions = await bridge.listSessionsByState('all')
      expect(allSessions.length).toBe(2)
      
      const activeSessions = await bridge.listSessionsByState('active')
      expect(activeSessions.length).toBe(1)
      expect(activeSessions[0].status).toBe('active')
      
      const draftSessions = await bridge.listSessionsByState('spec')
      expect(draftSessions.length).toBe(1)
      expect(draftSessions[0].status).toBe('spec')
    })
  })

  describe('Error Handling', () => {
    test('Cannot update non-spec session as spec', async () => {
      bridge['createWorktree'] = async (_, name) => path.join(testRepoPath, '.schaltwerk', 'worktrees', name)
      await bridge.createSession('active-no-spec', 'active')
      
      await expect(
        bridge.updateDraftContent('active-no-spec', 'new content')
      ).rejects.toThrow("is not a spec")
    })
    
    test('Cannot start non-existent spec', async () => {
      await expect(
        bridge.startDraftSession('non-existent', 'claude', false)
      ).rejects.toThrow("not found")
    })
    
    test('Cannot delete non-spec session', async () => {
      bridge['createWorktree'] = async (_, name) => path.join(testRepoPath, '.schaltwerk', 'worktrees', name)
      await bridge.createSession('active-no-delete', 'active')
      
      await expect(
        bridge.deleteDraftSession('active-no-delete')
      ).rejects.toThrow("is not a spec")
    })
  })

  describe('Webhook Notifications', () => {
    test('Spec creation triggers webhook', async () => {
      let webhookCalled = false
      let webhookPayload: any = null
      
      const originalFetch = global.fetch
      global.fetch = jest.fn(async (url: string, options: any) => {
        if (url.includes('/webhook/spec-created')) {
          webhookCalled = true
          webhookPayload = JSON.parse(options.body)
        }
        return { ok: true } as any
      }) as any
      
      const draftName = `webhook-test-${Date.now()}`
      await bridge.createSpecSession(draftName, 'webhook content')
      
      expect(webhookCalled).toBe(true)
      expect(webhookPayload).toMatchObject({
        session_name: draftName,
        draft_content: 'webhook content',
        status: 'spec'
      })
      
      global.fetch = originalFetch
    })
    
    test('Session start triggers webhook', async () => {
      let webhookCalled = false
      let webhookPayload: any = null
      
      const originalFetch = global.fetch
      global.fetch = jest.fn(async (url: string, options: any) => {
        if (url.includes('/webhook/session-added')) {
          webhookCalled = true
          webhookPayload = JSON.parse(options.body)
        }
        return { ok: true } as any
      }) as any
      
      const draftName = `start-webhook-${Date.now()}`
      bridge['createWorktree'] = async () => path.join(testRepoPath, '.schaltwerk', 'worktrees', draftName)
      
      await bridge.createSpecSession(draftName, 'content')
      webhookCalled = false
      await bridge.startDraftSession(draftName)
      
      expect(webhookCalled).toBe(true)
      expect(webhookPayload).toMatchObject({
        session_name: draftName,
        branch: `schaltwerk/${draftName}`
      })
      
      global.fetch = originalFetch
    })
  })

  describe('Database to API Migration', () => {
    test('Sessions retrieved consistently', async () => {
      const sessionName = `consistency-${Date.now()}`
      await bridge.createSpecSession(sessionName, 'content')
      
      const fromDB = await bridge.getSession(sessionName)
      
      expect(fromDB).toBeDefined()
      expect(fromDB?.name).toBe(sessionName)
      expect(fromDB?.status).toBe('spec')
    })
    
    test('Concurrent operations handled correctly', async () => {
      const baseName = `concurrent-${Date.now()}`
      
      const promises = Array.from({ length: 5 }, (_, i) => 
        bridge.createSpecSession(`${baseName}-${i}`, `content-${i}`)
      )
      
      const results = await Promise.all(promises)
      
      expect(results.length).toBe(5)
      results.forEach((session, i) => {
        expect(session.name).toBe(`${baseName}-${i}`)
        expect(session.draft_content).toBe(`content-${i}`)
      })
      
      const allDrafts = await bridge.listDraftSessions()
      const relevantDrafts = allDrafts.filter(d => d.name.startsWith(baseName))
      expect(relevantDrafts.length).toBe(5)
    })
  })

  describe('Performance Tests', () => {
    test('Spec operations complete within acceptable time', async () => {
      const startCreate = Date.now()
      const draftName = `perf-test-${Date.now()}`
      await bridge.createSpecSession(draftName, 'performance test')
      const createTime = Date.now() - startCreate
      
      expect(createTime).toBeLessThan(100)
      
      const startUpdate = Date.now()
      await bridge.updateDraftContent(draftName, 'updated')
      const updateTime = Date.now() - startUpdate
      
      expect(updateTime).toBeLessThan(50)
      
      const startList = Date.now()
      await bridge.listDraftSessions()
      const listTime = Date.now() - startList
      
      expect(listTime).toBeLessThan(50)
    })
  })
})