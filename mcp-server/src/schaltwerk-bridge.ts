import fetch, { type RequestInit, type Response } from 'node-fetch'
import * as path from 'path'
import * as os from 'os'
import * as fs from 'fs'
import { execSync } from 'child_process'
import { createHash } from 'crypto'

export interface Session {
  id: string
  name: string
  display_name?: string
  repository_path: string
  repository_name: string
  branch: string
  parent_branch: string
  worktree_path: string
  status: 'active' | 'cancelled' | 'spec'
  session_state?: 'Spec' | 'Running' | 'Reviewed'
  created_at: number
  updated_at: number
  last_activity?: number
  initial_prompt?: string
  draft_content?: string
  spec_content?: string
  ready_to_merge: boolean
  original_agent_type?: string
  original_skip_permissions?: boolean
  pending_name_generation: boolean
  was_auto_generated: boolean
}

interface GitStatusResult {
  hasUncommittedChanges: boolean
  modifiedFiles: number
  untrackedFiles: number
  stagedFiles: number
  changedFiles: string[]
}

export type MergeModeOption = 'squash' | 'reapply'

interface MergeSessionApiResponse {
  session_name: string
  parent_branch: string
  session_branch: string
  mode: MergeModeOption
  commit: string
  cancel_requested: boolean
  cancel_queued: boolean
  cancel_error?: string | null
}

export interface MergeSessionResult {
  sessionName: string
  parentBranch: string
  sessionBranch: string
  mode: MergeModeOption
  commit: string
  cancelRequested: boolean
  cancelQueued: boolean
  cancelError?: string
}

interface PullRequestApiResponse {
  session_name: string
  branch: string
  url: string
  cancel_requested: boolean
  cancel_queued: boolean
  cancel_error?: string | null
}

export interface PullRequestResult {
  sessionName: string
  branch: string
  url: string
  cancelRequested: boolean
  cancelQueued: boolean
  cancelError?: string
}

interface ProjectContext {
  path: string
  canonicalPath: string
  hash: string
  name: string
  identifier: string
}

function detectProjectPath(): string {
  try {
    // First try the environment variable (if set by Tauri app)
    if (process.env.SCHALTWERK_PROJECT_PATH) {
      return process.env.SCHALTWERK_PROJECT_PATH
    }
    
    // Otherwise, find the git root from current working directory
    const gitRoot = execSync('git rev-parse --show-toplevel', {
      cwd: process.cwd(),
      stdio: 'pipe',
      encoding: 'utf8'
    }).toString().trim()
    
    return gitRoot
  } catch (error) {
    console.warn('Could not detect project path from git root, using current directory:', error)
    return process.cwd()
  }
}

function createProjectContext(projectPath: string): ProjectContext {
  try {
    // Get canonical path (matching Rust backend logic)
    const canonicalPath = fs.realpathSync(projectPath)
    
    // Create hash of the full path (matching Rust backend SHA256 logic)
    const hash = createHash('sha256')
      .update(canonicalPath)
      .digest('hex')
      .substring(0, 16) // Take first 16 characters like Rust backend
    
    // Get project name for readability (matching Rust backend logic)
    const projectName = path.basename(canonicalPath) || 'unknown'
    const safeName = projectName.replace(/[^a-zA-Z0-9\-_]/g, '_')
    
    // Create identifier: "projectname_hash" (matching Rust backend format)
    const identifier = `${safeName}_${hash}`
    
    return {
      path: projectPath,
      canonicalPath,
      hash,
      name: projectName,
      identifier
    }
  } catch (error) {
    console.error('Failed to create project context:', error)
    // Fallback context
    const safePath = projectPath.replace(/[^a-zA-Z0-9\-_]/g, '_')
    return {
      path: projectPath,
      canonicalPath: projectPath,
      hash: 'unknown',
      name: path.basename(projectPath),
      identifier: `${safePath}_fallback`
    }
  }
}

export class SchaltwerkBridge {
  private readonly projectContext: ProjectContext
  private readonly portCandidates: number[]
  private activePort: number | null = null
  private readonly host = '127.0.0.1'
  private hasLoggedPort = false

  constructor() {
    // Detect and establish project context
    const projectPath = detectProjectPath()
    this.projectContext = createProjectContext(projectPath)
    this.portCandidates = this.resolveCandidatePorts()
    
    console.error(`MCP Bridge initialized for project: ${this.projectContext.name}`)
    console.error(`Project path: ${this.projectContext.canonicalPath}`)
    console.error(`Project identifier: ${this.projectContext.identifier}`)
  }

  private getProjectHeaders(): Record<string, string> {
    return {
      'X-Project-Path': this.projectContext.canonicalPath,
      'X-Project-Hash': this.projectContext.hash,
      'X-Project-Name': this.projectContext.name,
      'X-Project-Identifier': this.projectContext.identifier
    }
  }

  private calculateBasePort(): number {
    try {
      const digest = createHash('sha256')
        .update(this.projectContext.canonicalPath)
        .digest()
      const offset = ((digest[0] << 8) | digest[1]) % 100
      return 8547 + offset
    } catch (error) {
      console.warn('Failed to calculate project-specific MCP port, falling back to default:', error)
      return 8547
    }
  }

  private resolveCandidatePorts(): number[] {
    const seen = new Set<number>()
    const ports: number[] = []
    const addPort = (port?: number | null) => {
      if (typeof port === 'number' && Number.isInteger(port) && port > 0 && port < 65536 && !seen.has(port)) {
        seen.add(port)
        ports.push(port)
      }
    }

    const envPort = process.env.SCHALTWERK_MCP_PORT ? Number.parseInt(process.env.SCHALTWERK_MCP_PORT, 10) : undefined
    addPort(envPort)

    const basePort = this.calculateBasePort()
    addPort(basePort)

    const preferredFallbacks = [8548, 8549, 8550]
    preferredFallbacks.forEach(addPort)

    for (let offset = 1; offset <= 5; offset += 1) {
      addPort(basePort + offset)
    }

    // Always include the global default port so we can reach the backend
    // before a project context has been established.
    addPort(8547)

    return ports
  }

  private getPortAttemptOrder(): number[] {
    if (this.activePort === null) {
      return [...this.portCandidates]
    }

    return [this.activePort, ...this.portCandidates.filter(port => port !== this.activePort)]
  }

  private cloneInit(init: RequestInit): RequestInit {
    const headers = init.headers ? { ...(init.headers as Record<string, string>) } : undefined
    return { ...init, headers }
  }

  private isRetryableNetworkError(error: unknown): boolean {
    if (!error || typeof error !== 'object') {
      return false
    }

    const err = error as { code?: string }
    const retryable = new Set(['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'])
    return !!err.code && retryable.has(err.code)
  }

  private async fetchWithAutoPort(path: string, init: RequestInit): Promise<Response> {
    const attempts = this.getPortAttemptOrder()
    let lastError: unknown = null

    for (const port of attempts) {
      try {
        const response = await fetch(`http://${this.host}:${port}${path}`, this.cloneInit(init))
        this.activePort = port
        if (!this.hasLoggedPort) {
          console.error(`Schaltwerk MCP bridge connected to port ${port}`)
          this.hasLoggedPort = true
        }
        return response
      } catch (error) {
        if (this.isRetryableNetworkError(error)) {
          lastError = error
          continue
        }
        throw error
      }
    }

    const errorMessage =
      lastError instanceof Error ? lastError.message : lastError ? String(lastError) : 'unknown error'
    throw new Error(
      `Failed to reach Schaltwerk MCP service on ports ${attempts.join(', ')}: ${errorMessage}`
    )
  }

  async listSessions(): Promise<Session[]> {
    try {
      const response = await this.fetchWithAutoPort('/api/sessions', {
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          ...this.getProjectHeaders()
        }
      })
      
      if (!response.ok) {
        throw new Error(`Failed to list sessions: ${response.statusText}`)
      }
      
      // The response will be EnrichedSession objects from the backend
      const enrichedSessions = await response.json() as Array<{
        info: {
          session_id: string;
          display_name?: string;
          branch: string;
          base_branch: string;
          worktree_path: string;
          session_state: string;
          created_at?: string;
          updated_at?: string;
          last_activity?: string;
          initial_prompt?: string;
          draft_content?: string;
          spec_content?: string;
          ready_to_merge?: boolean;
          original_agent_type?: string;
          original_skip_permissions?: boolean;
          pending_name_generation?: boolean;
          was_auto_generated?: boolean;
        };
      }>
      
      // Convert EnrichedSession to Session format
      const sessions: Session[] = enrichedSessions.map(es => ({
        id: es.info.session_id,
        name: es.info.session_id,
        display_name: es.info.display_name || undefined,
        repository_path: '',
        repository_name: '',
        branch: es.info.branch,
        parent_branch: es.info.base_branch,
        worktree_path: es.info.worktree_path,
        status: es.info.session_state === 'spec' ? 'spec' as const : 'active' as const,
        session_state: es.info.session_state as 'Spec' | 'Running' | 'Reviewed' | undefined,
        created_at: es.info.created_at ? new Date(es.info.created_at).getTime() : Date.now(),
        updated_at: es.info.updated_at ? new Date(es.info.updated_at).getTime() : Date.now(),
        last_activity: es.info.last_activity ? new Date(es.info.last_activity).getTime() : undefined,
        initial_prompt: es.info.initial_prompt || undefined,
        draft_content: es.info.draft_content || undefined,
        spec_content: es.info.spec_content || undefined,
        ready_to_merge: es.info.ready_to_merge || false,
        original_agent_type: es.info.original_agent_type ?? undefined,
        original_skip_permissions: es.info.original_skip_permissions ?? undefined,
        pending_name_generation: es.info.pending_name_generation ?? false,
        was_auto_generated: es.info.was_auto_generated ?? false
      }))
      
      return sessions
    } catch (error) {
      console.error('Failed to list sessions via API:', error)
      return []
    }
  }

  async getSession(name: string): Promise<Session | undefined> {
    try {
      const response = await this.fetchWithAutoPort(`/api/sessions/${encodeURIComponent(name)}`, {
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          ...this.getProjectHeaders()
        }
      })
      
      if (response.status === 404) {
        return undefined
      }
      
      if (!response.ok) {
        throw new Error(`Failed to get session: ${response.statusText}`)
      }
      
      return await response.json() as Session
    } catch (error) {
      console.error('Failed to get session via API:', error)
      return undefined
    }
  }

  async createSession(name: string, prompt?: string, baseBranch?: string, agentType?: string, skipPermissions?: boolean): Promise<Session> {
    try {
      const response = await this.fetchWithAutoPort('/api/sessions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...this.getProjectHeaders()
        },
        body: JSON.stringify({
          name,
          prompt,
          base_branch: baseBranch,
          agent_type: agentType,
          skip_permissions: skipPermissions,
          user_edited_name: false
        })
      })

      if (!response.ok) {
        throw new Error(`Failed to create session: ${response.statusText}`)
      }

      const session = await response.json() as Session

      // Notify Schaltwerk UI about the new session
      await this.notifySessionAdded(session)

      return session
    } catch (error) {
      console.error('Failed to create session via API:', error)
      throw error
    }
  }

  async sendFollowUpMessage(sessionName: string, message: string): Promise<void> {
    const session = await this.getSession(sessionName)
    if (!session) {
      throw new Error(`Session '${sessionName}' not found`)
    }
    
    await this.notifyFollowUpMessage(sessionName, message)
  }

  async cancelSession(name: string, force: boolean = false): Promise<void> {
    
    const session = await this.getSession(name)
    if (!session) {
      throw new Error(`Session '${name}' not found`)
    }
    
    // Check for uncommitted changes unless force is true
    if (!force) {
      const gitStatus = await this.checkGitStatus(session.worktree_path)
      if (gitStatus.hasUncommittedChanges) {
        const changesSummary = gitStatus.changedFiles.length > 0 
          ? `\n\nFiles with changes:\n${gitStatus.changedFiles.map(f => `  - ${f}`).join('\n')}`
          : ''
        
        throw new Error(`⚠️ SAFETY CHECK FAILED: Session '${name}' has uncommitted changes that would be PERMANENTLY LOST.

📊 UNCOMMITTED WORK DETECTED:
- Modified files: ${gitStatus.modifiedFiles}
- New files: ${gitStatus.untrackedFiles}
- Staged changes: ${gitStatus.stagedFiles}${changesSummary}

🛡️ SAFETY OPTIONS:
1. RECOMMENDED: Commit your work first:
   - cd "${session.worktree_path}"
   - git add .
   - git commit -m "Save progress before cancellation"
   - Then retry cancellation

2. SAFER ALTERNATIVE: Use schaltwerk_convert_to_spec instead
   - Converts session to spec state, removing worktree but preserving branch
   - Can be restarted later with schaltwerk_draft_start

3. FORCE DELETION (DANGEROUS): Add force: true parameter
   - schaltwerk_cancel(session_name: "${name}", force: true)
   - ⚠️ THIS WILL PERMANENTLY DELETE ALL UNCOMMITTED WORK

💡 Your work is valuable - consider saving it before cancellation!`)
      }
    }
    
    // Remove worktree
    try {
      execSync(`cd "${session.repository_path}" && git worktree remove "${session.worktree_path}" --force`, {
        stdio: 'pipe'
      })
    } catch (error) {
      console.error(`Failed to remove worktree: ${error}`)
    }
    
    // Delete branch if it exists
    try {
      execSync(`cd "${session.repository_path}" && git branch -D "${session.branch}"`, {
        stdio: 'pipe'
      })
    } catch (error) {
      console.error(`Failed to delete branch: ${error}`)
    }
    
    // Cancel session via API
    try {
      const response = await this.fetchWithAutoPort(`/api/sessions/${encodeURIComponent(name)}`, {
        method: 'DELETE',
        headers: this.getProjectHeaders()
      })
      
      if (!response.ok) {
        throw new Error(`Failed to cancel session: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to cancel session via API, notifying manually:', error)
      // If API fails, at least notify the UI
      await this.notifySessionRemoved(name)
    }
  }

  private async checkGitStatus(worktreePath: string): Promise<GitStatusResult> {
    try {
      // Get git status --porcelain for machine-readable output
      const statusOutput = execSync('git status --porcelain', {
        cwd: worktreePath,
        stdio: 'pipe',
        encoding: 'utf8'
      }).toString()

      const lines = statusOutput.trim().split('\n').filter(line => line.length > 0)
      
      let modifiedFiles = 0
      let untrackedFiles = 0
      let stagedFiles = 0
      const changedFiles: string[] = []

      for (const line of lines) {
        const status = line.substring(0, 2)
        const filename = line.substring(3)
        changedFiles.push(filename)

        // Check staged changes (first character)
        if (status[0] !== ' ' && status[0] !== '?') {
          stagedFiles++
        }

        // Check unstaged changes (second character)
        if (status[1] === 'M') {
          modifiedFiles++
        }

        // Check untracked files
        if (status[0] === '?' && status[1] === '?') {
          untrackedFiles++
        }
      }

      return {
        hasUncommittedChanges: lines.length > 0,
        modifiedFiles,
        untrackedFiles,
        stagedFiles,
        changedFiles
      }
    } catch (error) {
      // If git status fails, assume no changes for safety
      console.warn(`Failed to check git status for ${worktreePath}: ${error}`)
      return {
        hasUncommittedChanges: false,
        modifiedFiles: 0,
        untrackedFiles: 0,
        stagedFiles: 0,
        changedFiles: []
      }
    }
  }

  private async getRepositoryPath(): Promise<string> {
    // Try to get from current directory
    const cwd = process.cwd()
    
    // Check if current directory is a git repository
    try {
      execSync('git rev-parse --show-toplevel', { cwd, stdio: 'pipe' })
      return cwd
    } catch {
      // If not, try to find the schaltwerk repository
      const possiblePaths = [
        path.join(os.homedir(), 'Documents', 'git', 'schaltwerk'),
        path.join(os.homedir(), 'Projects', 'schaltwerk'),
        path.join(os.homedir(), 'Code', 'schaltwerk'),
        path.join(os.homedir(), 'schaltwerk'),
      ]
      
      for (const p of possiblePaths) {
        if (fs.existsSync(path.join(p, '.git'))) {
          return p
        }
      }
      
      throw new Error('Could not find schaltwerk repository')
    }
  }

  private async getDefaultBranch(repoPath: string): Promise<string> {
    try {
      const result = execSync('git symbolic-ref refs/remotes/origin/HEAD', {
        cwd: repoPath,
        stdio: 'pipe'
      }).toString().trim()
      
      return result.replace('refs/remotes/origin/', '')
    } catch {
      // Fallback to common defaults
      try {
        execSync('git rev-parse --verify main', { cwd: repoPath, stdio: 'pipe' })
        return 'main'
      } catch {
        return 'master'
      }
    }
  }

  private async createWorktree(repoPath: string, sessionName: string, branchName: string, parentBranch: string): Promise<string> {
    const worktreePath = path.join(repoPath, '.schaltwerk', 'worktrees', sessionName)
    
    // Create worktree with new branch
    execSync(`git worktree add -b "${branchName}" "${worktreePath}" "${parentBranch}"`, {
      cwd: repoPath,
      stdio: 'pipe'
    })
    
    return worktreePath
  }

  private async notifySessionAdded(session: Session): Promise<void> {
    try {
      const payload = {
        session_name: session.name,
        branch: session.branch,
        worktree_path: session.worktree_path,
        parent_branch: session.parent_branch
      }
      
      await this.fetchWithAutoPort('/webhook/session-added', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (error) {
      console.warn('Failed to notify session added:', error)
    }
  }

  private async notifyDraftCreated(session: Session): Promise<void> {
    try {
      const payload = {
        session_name: session.name,
        draft_content: session.draft_content,
        parent_branch: session.parent_branch,
        status: 'spec'
      }
      
      await this.fetchWithAutoPort('/webhook/spec-created', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (error) {
      console.warn('Failed to notify spec created:', error)
    }
  }

  private async notifySessionRemoved(sessionName: string): Promise<void> {
    try {
      const payload = {
        session_name: sessionName
      }
      
      await this.fetchWithAutoPort('/webhook/session-removed', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (error) {
      console.warn('Failed to notify session removed:', error)
    }
  }

  private async notifyFollowUpMessage(sessionName: string, message: string): Promise<void> {
    try {
      const payload = {
        session_name: sessionName,
        message: message,
        timestamp: Date.now()
      }
      
      await this.fetchWithAutoPort('/webhook/follow-up-message', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
    } catch (error) {
      console.warn('Failed to notify follow-up message:', error)
    }
  }

  async createSpecSession(name: string, content?: string, baseBranch?: string): Promise<Session> {
    try {
      const response = await this.fetchWithAutoPort('/api/specs', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...this.getProjectHeaders()
        },
        body: JSON.stringify({
          name,
          content: content || '',
          parent_branch: baseBranch
        })
      })
      
      if (!response.ok) {
        throw new Error(`API error: ${response.statusText}`)
      }
      
      const session = await response.json() as Session
      await this.notifyDraftCreated(session)
      return session
    } catch (error) {
      console.error('Failed to create spec via API:', error)
      throw error
    }
  }

  async updateDraftContent(sessionName: string, content: string, append: boolean = false): Promise<void> {
    try {
      const response = await this.fetchWithAutoPort(`/api/specs/${encodeURIComponent(sessionName)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content,
          append
        })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to update spec content: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to update spec content via API:', error)
      throw error
    }
  }

  async startDraftSession(sessionName: string, agentType?: string, skipPermissions?: boolean, baseBranch?: string): Promise<void> {
    try {
      const response = await this.fetchWithAutoPort(`/api/specs/${encodeURIComponent(sessionName)}/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          agent_type: agentType,
          skip_permissions: skipPermissions,
          base_branch: baseBranch
        })
      })
      
      if (!response.ok) {
        throw new Error(`Failed to start spec session: ${response.statusText}`)
      }
      
      const updatedSession = await this.getSession(sessionName)
      if (updatedSession) {
        await this.notifySessionAdded(updatedSession)
      }
    } catch (error) {
      console.error('Failed to start spec session via API:', error)
      throw error
    }
  }

  async deleteDraftSession(sessionName: string): Promise<void> {
    try {
      const response = await this.fetchWithAutoPort(`/api/specs/${encodeURIComponent(sessionName)}`, {
        method: 'DELETE',
        headers: this.getProjectHeaders()
      })
      
      if (!response.ok) {
        throw new Error(`Failed to delete spec: ${response.statusText}`)
      }
      
      await this.notifySessionRemoved(sessionName)
    } catch (error) {
      console.error('Failed to delete spec session via API:', error)
      throw error
    }
  }

  async listDraftSessions(): Promise<Session[]> {
    try {
      const response = await this.fetchWithAutoPort('/api/specs', {
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          ...this.getProjectHeaders()
        }
      })
      
      if (!response.ok) {
        throw new Error(`Failed to list specs: ${response.statusText}`)
      }
      
      return await response.json() as Session[]
    } catch (error) {
      console.error('Failed to list spec sessions via API:', error)
      return []
    }
  }

  async listSessionsByState(filter?: 'all' | 'active' | 'spec' | 'reviewed'): Promise<Session[]> {
    try {
      if (filter === 'spec') {
        return this.listDraftSessions()
      }
      
      // Use query parameter for server-side filtering when possible
      let pathSegment = '/api/sessions'
      if (filter === 'reviewed') {
        pathSegment += '?state=reviewed'
      } else if (filter === 'active') {
        pathSegment += '?state=running'
      }
      
      const response = await this.fetchWithAutoPort(pathSegment, {
        method: 'GET',
        headers: { 
          'Accept': 'application/json',
          ...this.getProjectHeaders()
        }
      })
      
      if (!response.ok) {
        throw new Error(`Failed to list sessions: ${response.statusText}`)
      }
      
      // The response will be EnrichedSession objects from the backend
      // We need to map them to Session objects expected by MCP
      const enrichedSessions = await response.json() as Array<{
        info: {
          session_id: string;
          display_name?: string;
          branch: string;
          base_branch: string;
          worktree_path: string;
          session_state: string;
          created_at?: string;
          updated_at?: string;
          last_activity?: string;
          initial_prompt?: string;
          draft_content?: string;
          spec_content?: string;
          ready_to_merge?: boolean;
          original_agent_type?: string;
          original_skip_permissions?: boolean;
          pending_name_generation?: boolean;
          was_auto_generated?: boolean;
        };
      }>
      
      // Convert EnrichedSession to Session format
      let sessions: Session[] = enrichedSessions.map(es => ({
        id: es.info.session_id,
        name: es.info.session_id,
        display_name: es.info.display_name || undefined,
        repository_path: '',
        repository_name: '',
        branch: es.info.branch,
        parent_branch: es.info.base_branch,
        worktree_path: es.info.worktree_path,
        status: es.info.session_state === 'spec' ? 'spec' as const : 'active' as const,
        session_state: es.info.session_state as 'Spec' | 'Running' | 'Reviewed' | undefined,
        created_at: es.info.created_at ? new Date(es.info.created_at).getTime() : Date.now(),
        updated_at: es.info.updated_at ? new Date(es.info.updated_at).getTime() : Date.now(),
        last_activity: es.info.last_activity ? new Date(es.info.last_activity).getTime() : undefined,
        initial_prompt: es.info.initial_prompt || undefined,
        draft_content: es.info.draft_content || undefined,
        spec_content: es.info.spec_content || undefined,
        ready_to_merge: es.info.ready_to_merge || false,
        original_agent_type: es.info.original_agent_type ?? undefined,
        original_skip_permissions: es.info.original_skip_permissions ?? undefined,
        pending_name_generation: es.info.pending_name_generation ?? false,
        was_auto_generated: es.info.was_auto_generated ?? false
      }))
      
      // Don't duplicate specs - they're already included in enrichedSessions from API
      
      return sessions
    } catch (error) {
      console.error('Failed to list sessions by state via API:', error)
      return []
    }
  }

  async getCurrentTasks(): Promise<Session[]> {
    try {
      // Get all sessions and specs
      const [activeSessions, draftSessions] = await Promise.all([
        this.listSessions(),
        this.listDraftSessions()
      ])

      // Combine and return all current agents
      return [...activeSessions, ...draftSessions]
    } catch (error) {
      console.error('Failed to get current agents via API:', error)
      return []
    }
  }

  async markSessionReviewed(sessionName: string): Promise<void> {
    try {
      const response = await this.fetchWithAutoPort(`/api/sessions/${encodeURIComponent(sessionName)}/mark-reviewed`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...this.getProjectHeaders()
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to mark session as reviewed: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to mark session as reviewed via API:', error)
      throw error
    }
  }

  async mergeSession(
    sessionName: string,
    options: { commitMessage?: string | null; mode?: MergeModeOption; cancelAfterMerge?: boolean }
  ): Promise<MergeSessionResult> {
    const mode: MergeModeOption = options.mode === 'reapply' ? 'reapply' : 'squash'
    const commitMessage = options.commitMessage?.trim()

    if (mode === 'squash' && !commitMessage) {
      throw new Error('commitMessage is required and must be a non-empty string when performing a squash merge.')
    }

    const requestBody: Record<string, unknown> = {
      mode,
      cancel_after_merge: Boolean(options.cancelAfterMerge)
    }

    if (commitMessage && commitMessage.length > 0) {
      requestBody.commit_message = commitMessage
    }

    const response = await this.fetchWithAutoPort(`/api/sessions/${encodeURIComponent(sessionName)}/merge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getProjectHeaders()
      },
      body: JSON.stringify(requestBody)
    })

    const responseBody = await response.text()
    if (!response.ok) {
      const reason = responseBody ? ` - ${responseBody}` : ''
      throw new Error(`Failed to merge session '${sessionName}': ${response.status} ${response.statusText}${reason}`)
    }

    const payload = JSON.parse(responseBody) as MergeSessionApiResponse

    return {
      sessionName: payload.session_name,
      parentBranch: payload.parent_branch,
      sessionBranch: payload.session_branch,
      mode: payload.mode,
      commit: payload.commit,
      cancelRequested: payload.cancel_requested,
      cancelQueued: payload.cancel_queued,
      cancelError: payload.cancel_error ?? undefined
    }
  }

  async createPullRequest(
    sessionName: string,
    options: { commitMessage?: string; defaultBranch?: string; repository?: string; cancelAfterPr?: boolean }
  ): Promise<PullRequestResult> {
    const commitMessage = options.commitMessage?.trim()

    const response = await this.fetchWithAutoPort(`/api/sessions/${encodeURIComponent(sessionName)}/pull-request`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...this.getProjectHeaders()
      },
      body: JSON.stringify({
        commit_message: commitMessage && commitMessage.length > 0 ? commitMessage : undefined,
        default_branch: options.defaultBranch,
        repository: options.repository,
        cancel_after_pr: Boolean(options.cancelAfterPr)
      })
    })

    const responseBody = await response.text()
    if (!response.ok) {
      const reason = responseBody ? ` - ${responseBody}` : ''
      throw new Error(`Failed to create pull request for session '${sessionName}': ${response.status} ${response.statusText}${reason}`)
    }

    const payload = JSON.parse(responseBody) as PullRequestApiResponse

    return {
      sessionName: payload.session_name,
      branch: payload.branch,
      url: payload.url,
      cancelRequested: payload.cancel_requested,
      cancelQueued: payload.cancel_queued,
      cancelError: payload.cancel_error ?? undefined
    }
  }

  async convertToSpec(sessionName: string): Promise<void> {
    try {
      const response = await this.fetchWithAutoPort(`/api/sessions/${encodeURIComponent(sessionName)}/convert-to-spec`, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          ...this.getProjectHeaders()
        }
      })

      if (!response.ok) {
        throw new Error(`Failed to convert session to spec: ${response.statusText}`)
      }
    } catch (error) {
      console.error('Failed to convert session to spec via API:', error)
      throw error
    }
  }

  async getCurrentSpecModeSession(): Promise<string | null> {
    try {
      const response = await this.fetchWithAutoPort('/api/current-spec-mode-session', {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json',
          ...this.getProjectHeaders()
        }
      })

      if (!response.ok) {
        if (response.status === 404) {
          return null // No active spec mode session
        }
        throw new Error(`Failed to get current spec mode session: ${response.statusText}`)
      }

      const data = await response.json() as { session_name: string }
      return data.session_name
    } catch (error) {
      console.error('Failed to get current spec mode session:', error)
      return null
    }
  }
}
