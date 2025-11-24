import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import fs from 'fs'

const mockProjectPath = '/tmp/mock-project'
const persistedSpecContent = '# Stored spec content\n\nLine two'

const buildSpecSession = (overrides: Record<string, any> = {}) => {
  const sessionName = overrides.name ?? 'alpha_spec'
  return {
    id: overrides.id ?? sessionName,
    name: sessionName,
    repository_path: overrides.repository_path ?? mockProjectPath,
    repository_name: overrides.repository_name ?? 'mock-project',
    branch: overrides.branch ?? `schaltwerk/${sessionName}`,
    parent_branch: overrides.parent_branch ?? 'main',
    worktree_path: overrides.worktree_path ?? `${mockProjectPath}/.schaltwerk/worktrees/${sessionName}`,
    status: overrides.status ?? 'spec',
    created_at: overrides.created_at ?? Date.now(),
    updated_at: overrides.updated_at ?? Date.now(),
    ready_to_merge: overrides.ready_to_merge ?? false,
    pending_name_generation: overrides.pending_name_generation ?? false,
    was_auto_generated: overrides.was_auto_generated ?? false,
    spec_content: overrides.spec_content ?? persistedSpecContent,
    draft_content: overrides.draft_content,
  }
}

const diffSummaryMock = mock(() =>
  Promise.resolve({
    scope: 'session',
    session_id: 'fiery_maxwell',
    branch_info: {
      current_branch: 'schaltwerk/fiery_maxwell',
      parent_branch: 'main',
      merge_base_short: 'abc1234',
      head_short: 'def5678',
    },
    has_spec: true,
    files: [{ path: 'src/app.ts', change_type: 'modified' }],
    paging: { next_cursor: null, total_files: 1, returned: 1 },
  })
)

const diffChunkMock = mock(() =>
  Promise.resolve({
    file: { path: 'src/app.ts', change_type: 'modified' },
    branch_info: {
      current_branch: 'schaltwerk/fiery_maxwell',
      parent_branch: 'main',
      merge_base_short: 'abc1234',
      head_short: 'def5678',
    },
    stats: { additions: 10, deletions: 2 },
    is_binary: false,
    lines: [{ content: 'const a = 1;', line_type: 'added', new_line_number: 3 }],
    paging: { cursor: null, next_cursor: null, returned: 1 },
  })
)

const getSessionSpecMock = mock(() =>
  Promise.resolve({
    session_id: 'fiery_maxwell',
    content: '# Spec',
    updated_at: '2024-05-01T12:34:56Z',
  })
)

const specListMock = mock(() =>
  Promise.resolve([
    {
      session_id: 'alpha_spec',
      display_name: 'Alpha Spec',
      content_length: 256,
      updated_at: '2024-05-01T12:00:00Z',
    },
  ])
)

const specReadMock = mock(() =>
  Promise.resolve({
    session_id: 'alpha_spec',
    display_name: 'Alpha Spec',
    content: '# Alpha',
    content_length: 7,
    updated_at: '2024-05-01T12:00:00Z',
  })
)

const createSpecSessionMock = mock((name?: string, _content?: string, baseBranch?: string) => {
  const sessionName = name ?? 'alpha_spec'
  return Promise.resolve(
    buildSpecSession({
      id: sessionName,
      name: sessionName,
      parent_branch: baseBranch ?? 'main',
    })
  )
})

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
    // no-op for tests
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
  },
  McpError: FakeMcpError,
}))

const getServer = () => {
  const server = serverState.instance
  if (!server) {
    throw new Error('Server instance not initialized')
  }
  return server
}

let bridgeModule: typeof import('../src/schaltwerk-bridge')
let originalGetDiffSummary: ((options: any) => Promise<any>) | undefined
let originalGetDiffChunk: ((options: any) => Promise<any>) | undefined
let originalGetSessionSpec: ((session: string) => Promise<any>) | undefined
let originalListSpecSummaries: (() => Promise<any>) | undefined
let originalGetSpecDocument: ((session: string) => Promise<any>) | undefined
let originalCreateSpecSession: ((name: string, content?: string, baseBranch?: string) => Promise<any>) | undefined
let createdProjectDir = false

describe('MCP diff tools integration', () => {
  beforeAll(async () => {
    if (!fs.existsSync(mockProjectPath)) {
      fs.mkdirSync(mockProjectPath, { recursive: true })
      createdProjectDir = true
    }

    process.env.SCHALTWERK_PROJECT_PATH = mockProjectPath
    bridgeModule = await import('../src/schaltwerk-bridge')
    originalGetDiffSummary = bridgeModule.SchaltwerkBridge.prototype.getDiffSummary
    originalGetDiffChunk = bridgeModule.SchaltwerkBridge.prototype.getDiffChunk
    originalGetSessionSpec = bridgeModule.SchaltwerkBridge.prototype.getSessionSpec
    originalListSpecSummaries = bridgeModule.SchaltwerkBridge.prototype.listSpecSummaries
    originalGetSpecDocument = bridgeModule.SchaltwerkBridge.prototype.getSpecDocument
    originalCreateSpecSession = bridgeModule.SchaltwerkBridge.prototype.createSpecSession

    bridgeModule.SchaltwerkBridge.prototype.getDiffSummary = function (options) {
      return diffSummaryMock(options)
    }
    bridgeModule.SchaltwerkBridge.prototype.getDiffChunk = function (options) {
      return diffChunkMock(options)
    }
    bridgeModule.SchaltwerkBridge.prototype.getSessionSpec = function (session) {
      return getSessionSpecMock(session)
    }
    bridgeModule.SchaltwerkBridge.prototype.listSpecSummaries = function () {
      return specListMock()
    }
    bridgeModule.SchaltwerkBridge.prototype.getSpecDocument = function (session) {
      return specReadMock(session)
    }
    bridgeModule.SchaltwerkBridge.prototype.createSpecSession = function (name: string, content?: string, baseBranch?: string) {
      return createSpecSessionMock(name, content, baseBranch)
    }

    await import(`../src/schaltwerk-mcp-server?diff=${Date.now()}`)
  })

  beforeEach(() => {
    diffSummaryMock.mockClear()
    diffChunkMock.mockClear()
    getSessionSpecMock.mockClear()
    specListMock.mockClear()
    specReadMock.mockClear()
    createSpecSessionMock.mockClear()
  })

  afterAll(() => {
    delete process.env.SCHALTWERK_PROJECT_PATH

    if (bridgeModule) {
      if (originalGetDiffSummary) {
        bridgeModule.SchaltwerkBridge.prototype.getDiffSummary = originalGetDiffSummary
      }
      if (originalGetDiffChunk) {
        bridgeModule.SchaltwerkBridge.prototype.getDiffChunk = originalGetDiffChunk
      }
      if (originalGetSessionSpec) {
        bridgeModule.SchaltwerkBridge.prototype.getSessionSpec = originalGetSessionSpec
      }
      if (originalListSpecSummaries) {
        bridgeModule.SchaltwerkBridge.prototype.listSpecSummaries = originalListSpecSummaries
      }
      if (originalGetSpecDocument) {
        bridgeModule.SchaltwerkBridge.prototype.getSpecDocument = originalGetSpecDocument
      }
      if (originalCreateSpecSession) {
        bridgeModule.SchaltwerkBridge.prototype.createSpecSession = originalCreateSpecSession
      }
    }

    if (createdProjectDir && fs.existsSync(mockProjectPath)) {
      fs.rmSync(mockProjectPath, { recursive: true, force: true })
    }
  })

  it('registers diff tools in the tool list', async () => {
    const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const listHandler = server.handlers.get(ListToolsRequestSchema)
    expect(typeof listHandler).toBe('function')
    const response = await listHandler()
    const toolNames = response.tools.map((tool: { name: string }) => tool.name)
    expect(toolNames).toContain('schaltwerk_diff_summary')
    expect(toolNames).toContain('schaltwerk_diff_chunk')
    expect(toolNames).toContain('schaltwerk_session_spec')

    const diffSummaryTool = response.tools.find((tool: { name: string }) => tool.name === 'schaltwerk_diff_summary')
    const diffChunkTool = response.tools.find((tool: { name: string }) => tool.name === 'schaltwerk_diff_chunk')
    const sessionSpecTool = response.tools.find((tool: { name: string }) => tool.name === 'schaltwerk_session_spec')

    expect(diffSummaryTool?.outputSchema).toBeDefined()
    expect(diffChunkTool?.outputSchema).toBeDefined()
    expect(sessionSpecTool?.outputSchema).toBeDefined()
  })

  it('invokes bridge for schaltwerk_diff_summary and returns JSON payload', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    expect(typeof callHandler).toBe('function')

    const response = await callHandler({
      params: { name: 'schaltwerk_diff_summary', arguments: { session: 'fiery_maxwell', page_size: 20 } },
    })

    expect(diffSummaryMock).toHaveBeenCalledTimes(1)
    expect(diffSummaryMock.mock.calls[0][0]).toEqual({ session: 'fiery_maxwell', pageSize: 20, cursor: undefined })

    const content = response.content?.[0]
    expect(content?.mimeType || content?.type).toBe('application/json')
    const parsed = JSON.parse(content?.text ?? '{}')
    expect(parsed.scope).toBe('session')

    expect(response.structuredContent?.scope).toBe('session')
    expect(response.structuredContent?.branch_info?.current_branch).toBe('schaltwerk/fiery_maxwell')
  })

  it('caps line_limit on schaltwerk_diff_chunk and forwards cursor', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: {
        name: 'schaltwerk_diff_chunk',
        arguments: { session: 'fiery_maxwell', path: 'src/app.ts', cursor: 'cursor-1', line_limit: 5000 },
      },
    })

    expect(diffChunkMock).toHaveBeenCalledWith({
      session: 'fiery_maxwell',
      path: 'src/app.ts',
      cursor: 'cursor-1',
      lineLimit: 1000,
    })
    const content = response.content?.[0]
    expect(content?.mimeType || content?.type).toBe('application/json')
    const parsed = JSON.parse(content?.text ?? '{}')
    expect(parsed.file.path).toBe('src/app.ts')
    expect(response.structuredContent?.file?.path).toBe('src/app.ts')
  })

  it('calls bridge for schaltwerk_session_spec', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_session_spec', arguments: { session: 'fiery_maxwell' } },
    })

    expect(getSessionSpecMock).toHaveBeenCalledWith('fiery_maxwell')
    const content = response.content?.[0]
    expect(content?.mimeType || content?.type).toBe('application/json')
    const parsed = JSON.parse(content?.text ?? '{}')
    expect(parsed.content).toBe('# Spec')
    expect(response.structuredContent?.content).toBe('# Spec')
  })

  it('returns spec summaries via schaltwerk_spec_list', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_spec_list', arguments: {} },
    })

    expect(specListMock).toHaveBeenCalledTimes(1)
    const content = response.content?.[0]
    expect(content?.mimeType || content?.type).toBe('application/json')
    const parsed = JSON.parse(content?.text ?? '{}')
    expect(parsed.specs?.[0]?.session_id).toBe('alpha_spec')
    expect(response.structuredContent?.specs?.[0]?.session_id).toBe('alpha_spec')
  })

  it('reads spec content via schaltwerk_spec_read', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_spec_read', arguments: { session: 'alpha_spec' } },
    })

    expect(specReadMock).toHaveBeenCalledWith('alpha_spec')
    const content = response.content?.[0]
    expect(content?.mimeType || content?.type).toBe('application/json')
    const parsed = JSON.parse(content?.text ?? '{}')
    expect(parsed.session_id).toBe('alpha_spec')
    expect(parsed.content).toBe('# Alpha')
    expect(response.structuredContent?.session_id).toBe('alpha_spec')
    expect(response.structuredContent?.content).toBe('# Alpha')
  })

  it('reports persisted spec content length when creating spec sessions', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const server = getServer()

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: {
        name: 'schaltwerk_spec_create',
        arguments: { name: 'spec-alpha', content: '# Provided Content', base_branch: 'develop' },
      },
    })

    expect(createSpecSessionMock).toHaveBeenCalledWith('spec-alpha', '# Provided Content', 'develop')
    const content = response.content?.[0]
    const text = content?.text ?? ''
    expect(text).toContain(`- Content Length: ${persistedSpecContent.length} characters`)
    expect(text).not.toContain('- Content Length: 0 characters')
  })
})
