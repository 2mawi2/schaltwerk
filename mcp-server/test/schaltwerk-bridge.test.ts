import { SchaltwerkBridge, Session } from './schaltwerk-bridge'
import * as fs from 'fs'
import * as path from 'path'
import * as os from 'os'
import { execSync } from 'child_process'

describe('SchaltwerkBridge Plan Sessions', () => {
  let bridge: SchaltwerkBridge
  let testDbPath: string
  let testRepoPath: string

  beforeAll(async () => {
    // Create a test repository
    testRepoPath = path.join(os.tmpdir(), `test-repo-${Date.now()}`)
    fs.mkdirSync(testRepoPath, { recursive: true })
    execSync('git init', { cwd: testRepoPath })
    execSync('git config user.email "test@example.com"', { cwd: testRepoPath })
    execSync('git config user.name "Test User"', { cwd: testRepoPath })
    execSync('echo "test" > README.md', { cwd: testRepoPath })
    execSync('git add .', { cwd: testRepoPath })
    execSync('git commit -m "Initial commit"', { cwd: testRepoPath })
    
    // Create test database directory
    const dataDir = path.join(os.tmpdir(), `test-schaltwerk-${Date.now()}`)
    const projectDir = path.join(dataDir, 'projects', 'schaltwerk_test')
    fs.mkdirSync(projectDir, { recursive: true })
    testDbPath = path.join(projectDir, 'sessions.db')
    
    // Mock the database path in the bridge
    bridge = new SchaltwerkBridge()
    // Override the dbPath
    ;(bridge as any).dbPath = testDbPath
    
    // Mock getRepositoryPath to return our test repo
    bridge['getRepositoryPath'] = async () => testRepoPath
    
    // Bridge no longer needs connection - it's stateless
    
    // Initialize database schema
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
    
    // Database no longer directly accessed - tests need API server running
  })

  afterAll(async () => {
    // Bridge no longer needs disconnection - it's stateless
    // Clean up test files
    if (fs.existsSync(testRepoPath)) {
      execSync(`rm -rf "${testRepoPath}"`)
    }
  })

  describe('Plan Creation and Retrieval', () => {
    it('should create a plan session and be able to retrieve it', async () => {
      // Create a plan session
      const draftName = 'test-plan-session'
      const draftContent = '# Test Plan\n\nThis is a test plan content.'
      
      const createdDraft = await bridge.createDraftSession(draftName, draftContent)
      
      // Verify the created plan has correct properties
      expect(createdDraft.name).toBe(draftName)
      expect(createdDraft.status).toBe('plan')
      expect(createdDraft.session_state).toBe('Plan')
      expect(createdDraft.draft_content).toBe(draftContent)
      expect(createdDraft.branch).toBe(`schaltwerk/${draftName}`)
      
      // Try to get the session using getSession (this is where the bug might be)
      const retrievedSession = await bridge.getSession(draftName)
      
      // THIS TEST SHOULD FAIL if the bug exists
      // getSession filters by status IN ('active', 'paused') which excludes 'plan'
      expect(retrievedSession).toBeDefined()
      expect(retrievedSession?.name).toBe(draftName)
      expect(retrievedSession?.status).toBe('plan')
      expect(retrievedSession?.draft_content).toBe(draftContent)
    })

    it('should list plan sessions separately from active sessions', async () => {
      // Create a plan and an active session
      const draftName = 'plan-test-2'
      const activeName = 'active-test-1'
      
      await bridge.createDraftSession(draftName, 'Plan content')
      
      // Create an active session (mock the worktree creation)
      bridge['createWorktree'] = async () => path.join(testRepoPath, '.schaltwerk', 'worktrees', activeName)
      await bridge.createSession(activeName, 'Active session prompt')
      
      // List plan sessions
      const plans = await bridge.listDraftSessions()
      const draftNames = plans.map(d => d.name)
      
      expect(draftNames).toContain(draftName)
      expect(draftNames).not.toContain(activeName)
      
      // List regular sessions
      const sessions = await bridge.listSessions()
      const sessionNames = sessions.map(s => s.name)
      
      expect(sessionNames).toContain(activeName)
      expect(sessionNames).not.toContain(draftName)
    })

    it('should be able to update plan content', async () => {
      const draftName = 'plan-to-update'
      const initialContent = 'Initial content'
      const updatedContent = 'Updated content'
      
      await bridge.createDraftSession(draftName, initialContent)
      
      // Update the plan content
      await bridge.updateDraftContent(draftName, updatedContent, false)
      
      // Retrieve and verify
      const session = await bridge.getSession(draftName)
      
      // THIS WILL FAIL if getSession can't retrieve plans
      expect(session).toBeDefined()
      expect(session?.draft_content).toBe(updatedContent)
    })

    it('should fail to update non-plan sessions', async () => {
      const activeName = 'active-no-update'
      
      // Create an active session
      bridge['createWorktree'] = async () => path.join(testRepoPath, '.schaltwerk', 'worktrees', activeName)
      await bridge.createSession(activeName, 'Active session')
      
      // Try to update as if it were a plan
      await expect(bridge.updateDraftContent(activeName, 'New content')).rejects.toThrow()
    })

    it('should filter sessions by state correctly', async () => {
      // Clean up existing sessions first
      // Database no longer directly accessed - would need to call API to clean up
      
      // Create various types of sessions
      await bridge.createDraftSession('plan-filter-1', 'Plan 1')
      await bridge.createDraftSession('plan-filter-2', 'Plan 2')
      
      bridge['createWorktree'] = async (_, name) => path.join(testRepoPath, '.schaltwerk', 'worktrees', name)
      await bridge.createSession('active-filter-1', 'Active 1')
      await bridge.createSession('active-filter-2', 'Active 2')
      
      // Test different filters
      const allSessions = await bridge.listSessionsByState('all')
      const activeSessions = await bridge.listSessionsByState('active')
      const draftSessions = await bridge.listSessionsByState('plan')
      
      expect(allSessions.length).toBe(4)
      expect(activeSessions.length).toBe(2)
      expect(draftSessions.length).toBe(2)
      
      expect(draftSessions.every(s => s.status === 'plan')).toBe(true)
      expect(activeSessions.every(s => s.status === 'active')).toBe(true)
    })
  })

  describe('Plan to Active Transition', () => {
    it('should start a plan session and transition it to active', async () => {
      const draftName = 'plan-to-start'
      const draftContent = '# Agent\n\nImplement feature X'
      
      // Create plan
      await bridge.createDraftSession(draftName, draftContent)
      
      // Mock worktree creation
      bridge['createWorktree'] = async () => path.join(testRepoPath, '.schaltwerk', 'worktrees', draftName)
      
      // Start the plan
      await bridge.startDraftSession(draftName, 'claude', false)
      
      // Verify it's now active
      const session = await bridge.getSession(draftName)
      
      expect(session).toBeDefined()
      expect(session?.status).toBe('active')
      expect(session?.session_state).toBe('Running')
      expect(session?.initial_prompt).toBe(draftContent)
      expect(session?.original_agent_type).toBe('claude')
    })
  })
})