import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import fs from 'fs'

const serverState: { instance: FakeServer | null } = { instance: null }

class FakeServer {
  handlers = new Map<unknown, (request?: any) => Promise<any>>()

  constructor() {
    serverState.instance = this
  }

  setRequestHandler(schema: unknown, handler: (request: any) => Promise<any>) {
    this.handlers.set(schema, handler)
  }

  async connect() {
    // no-op
  }
}

mock.module('@modelcontextprotocol/sdk/server/index.js', () => ({
  Server: FakeServer,
  __serverState: serverState,
}))

mock.module('@modelcontextprotocol/sdk/server/stdio.js', () => ({
  StdioServerTransport: class {},
}))

const listToolsSchema = Symbol('ListTools')
const callToolSchema = Symbol('CallTool')
const listResourcesSchema = Symbol('ListResources')
const readResourceSchema = Symbol('ReadResource')

class FakeMcpError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

mock.module('@modelcontextprotocol/sdk/types.js', () => ({
  ListToolsRequestSchema: listToolsSchema,
  CallToolRequestSchema: callToolSchema,
  ListResourcesRequestSchema: listResourcesSchema,
  ReadResourceRequestSchema: readResourceSchema,
  ErrorCode: {
    InternalError: 'INTERNAL_ERROR',
    MethodNotFound: 'METHOD_NOT_FOUND',
    InvalidParams: 'INVALID_PARAMS',
    InvalidRequest: 'INVALID_REQUEST',
  },
  McpError: FakeMcpError,
}))

const getServer = () => {
  const server = serverState.instance
  if (!server) {
    throw new Error('Server not initialized')
  }
  return server
}

const mockProjectPath = '/tmp/mock-project-structured'

const mockSessions = [
  {
    id: 'alpha',
    name: 'alpha',
    repository_path: mockProjectPath,
    repository_name: 'mock-project-structured',
    branch: 'schaltwerk/alpha',
    parent_branch: 'main',
    worktree_path: `${mockProjectPath}/.schaltwerk/worktrees/alpha`,
    status: 'spec',
    created_at: Date.now(),
    updated_at: Date.now(),
    ready_to_merge: false,
    pending_name_generation: false,
    was_auto_generated: false,
    session_state: 'Spec',
    draft_content: '# Plan',
  },
]

const mockTasks = [
  {
    name: 'alpha',
    display_name: 'Alpha',
    status: 'spec',
    session_state: 'Spec',
    branch: 'schaltwerk/alpha',
    ready_to_merge: false,
    original_agent_type: 'claude',
    initial_prompt: 'prompt',
    draft_content: 'plan',
  },
]

const listSessionsMock = mock(() => Promise.resolve(mockSessions))
const getCurrentTasksMock = mock(() => Promise.resolve(mockTasks))
const createSessionMock = mock(() =>
  Promise.resolve({
    name: 'beta',
    branch: 'schaltwerk/beta',
    worktree_path: `${mockProjectPath}/.schaltwerk/worktrees/beta`,
    parent_branch: 'main',
    ready_to_merge: false,
    initial_prompt: 'do work',
  })
)

let bridgeModule: typeof import('../src/schaltwerk-bridge')
let originalListSessions: ((filter?: any) => Promise<any>) | undefined
let originalGetCurrentTasks: (() => Promise<any>) | undefined
let originalCreateSession: ((...args: any[]) => Promise<any>) | undefined
let createdProjectDir = false

describe('Structured content responses', () => {
  beforeAll(async () => {
    if (!fs.existsSync(mockProjectPath)) {
      fs.mkdirSync(mockProjectPath, { recursive: true })
      createdProjectDir = true
    }
    process.env.SCHALTWERK_PROJECT_PATH = mockProjectPath
    bridgeModule = await import('../src/schaltwerk-bridge')

    originalListSessions = bridgeModule.SchaltwerkBridge.prototype.listSessionsByState
    originalGetCurrentTasks = bridgeModule.SchaltwerkBridge.prototype.getCurrentTasks
    originalCreateSession = bridgeModule.SchaltwerkBridge.prototype.createSession

    bridgeModule.SchaltwerkBridge.prototype.listSessionsByState = () => listSessionsMock()
    bridgeModule.SchaltwerkBridge.prototype.getCurrentTasks = () => getCurrentTasksMock()
    bridgeModule.SchaltwerkBridge.prototype.createSession = (...args: any[]) => createSessionMock(...args)

    await import(`../src/schaltwerk-mcp-server?structured=${Date.now()}`)
  })

  beforeEach(() => {
    listSessionsMock.mockClear()
    getCurrentTasksMock.mockClear()
    createSessionMock.mockClear()
  })

  afterAll(() => {
    delete process.env.SCHALTWERK_PROJECT_PATH
    if (bridgeModule) {
      if (originalListSessions) {
        bridgeModule.SchaltwerkBridge.prototype.listSessionsByState = originalListSessions
      }
      if (originalGetCurrentTasks) {
        bridgeModule.SchaltwerkBridge.prototype.getCurrentTasks = originalGetCurrentTasks
      }
      if (originalCreateSession) {
        bridgeModule.SchaltwerkBridge.prototype.createSession = originalCreateSession
      }
    }

    if (createdProjectDir && fs.existsSync(mockProjectPath)) {
      fs.rmSync(mockProjectPath, { recursive: true, force: true })
    }
  })

  it('advertises output schemas for list and task tools', async () => {
    const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const listHandler = server.handlers.get(ListToolsRequestSchema)
    const response = await listHandler()
    const listTool = response.tools.find((tool: any) => tool.name === 'schaltwerk_list')
    const tasksTool = response.tools.find((tool: any) => tool.name === 'schaltwerk_get_current_tasks')
    const createTool = response.tools.find((tool: any) => tool.name === 'schaltwerk_create')

    expect(listTool?.outputSchema).toBeDefined()
    expect(tasksTool?.outputSchema).toBeDefined()
    expect(createTool?.outputSchema).toBeDefined()
  })

  it('returns structured sessions for schaltwerk_list', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_list', arguments: { filter: 'spec', json: false } },
    })

    expect(listSessionsMock).toHaveBeenCalledTimes(1)
    expect(Array.isArray(response.structuredContent?.sessions)).toBeTrue()
    expect(response.structuredContent?.sessions?.[0]?.name).toBe('alpha')
  })

  it('returns structured tasks for schaltwerk_get_current_tasks', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_get_current_tasks', arguments: { fields: ['name', 'status', 'branch'] } },
    })

    expect(getCurrentTasksMock).toHaveBeenCalledTimes(1)
    expect(response.structuredContent?.tasks?.[0]?.name).toBe('alpha')
    expect(response.structuredContent?.tasks?.[0]?.status).toBe('spec')
  })

  it('returns structured session info for schaltwerk_create', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_create', arguments: { name: 'beta', prompt: 'do work', agent_type: 'claude' } },
    })

    expect(createSessionMock).toHaveBeenCalledTimes(1)
    expect(response.structuredContent?.status).toBe('created')
    expect(response.structuredContent?.session?.name).toBe('beta')
  })
})
