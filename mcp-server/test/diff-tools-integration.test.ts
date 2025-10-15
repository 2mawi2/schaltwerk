import { afterAll, beforeAll, beforeEach, describe, expect, it, mock } from 'bun:test'
import fs from 'fs'

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

let bridgeModule: typeof import('../src/schaltwerk-bridge')
let originalGetDiffSummary: ((options: any) => Promise<any>) | undefined
let originalGetDiffChunk: ((options: any) => Promise<any>) | undefined
let originalGetSessionSpec: ((session: string) => Promise<any>) | undefined
let originalListSpecSummaries: (() => Promise<any>) | undefined
let originalGetSpecDocument: ((session: string) => Promise<any>) | undefined
let createdProjectDir = false
const mockProjectPath = '/tmp/mock-project'

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

    await import('../src/schaltwerk-mcp-server')
  })

  beforeEach(() => {
    diffSummaryMock.mockClear()
    diffChunkMock.mockClear()
    getSessionSpecMock.mockClear()
    specListMock.mockClear()
    specReadMock.mockClear()
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
    }

    if (createdProjectDir && fs.existsSync(mockProjectPath)) {
      fs.rmSync(mockProjectPath, { recursive: true, force: true })
    }
  })

  it('registers diff tools in the tool list', async () => {
    const { ListToolsRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const serverModule = await import('@modelcontextprotocol/sdk/server/index.js')
    const server = serverModule.__serverState.instance
    if (!server) {
      throw new Error('Server instance not initialized')
    }

    const listHandler = server.handlers.get(ListToolsRequestSchema)
    expect(typeof listHandler).toBe('function')
    const response = await listHandler()
    const toolNames = response.tools.map((tool: { name: string }) => tool.name)
    expect(toolNames).toContain('schaltwerk_diff_summary')
    expect(toolNames).toContain('schaltwerk_diff_chunk')
    expect(toolNames).toContain('schaltwerk_session_spec')
  })

  it('invokes bridge for schaltwerk_diff_summary and returns JSON payload', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const serverModule = await import('@modelcontextprotocol/sdk/server/index.js')
    const server = serverModule.__serverState.instance
    if (!server) {
      throw new Error('Server instance not initialized')
    }

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
  })

  it('caps line_limit on schaltwerk_diff_chunk and forwards cursor', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const { __serverState } = await import('@modelcontextprotocol/sdk/server/index.js')
    const server = __serverState.instance
    if (!server) {
      throw new Error('Server instance not initialized')
    }

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
  })

  it('calls bridge for schaltwerk_session_spec', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const { __serverState } = await import('@modelcontextprotocol/sdk/server/index.js')
    const server = __serverState.instance
    if (!server) {
      throw new Error('Server instance not initialized')
    }

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_session_spec', arguments: { session: 'fiery_maxwell' } },
    })

    expect(getSessionSpecMock).toHaveBeenCalledWith('fiery_maxwell')
    const content = response.content?.[0]
    expect(content?.mimeType || content?.type).toBe('application/json')
    const parsed = JSON.parse(content?.text ?? '{}')
    expect(parsed.content).toBe('# Spec')
  })

  it('returns spec summaries via schaltwerk_spec_list', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const { __serverState } = await import('@modelcontextprotocol/sdk/server/index.js')
    const server = __serverState.instance
    if (!server) {
      throw new Error('Server instance not initialized')
    }

    const callHandler = server.handlers.get(CallToolRequestSchema)
    const response = await callHandler({
      params: { name: 'schaltwerk_spec_list', arguments: {} },
    })

    expect(specListMock).toHaveBeenCalledTimes(1)
    const content = response.content?.[0]
    expect(content?.mimeType || content?.type).toBe('application/json')
    const parsed = JSON.parse(content?.text ?? '{}')
    expect(parsed.specs?.[0]?.session_id).toBe('alpha_spec')
  })

  it('reads spec content via schaltwerk_spec_read', async () => {
    const { CallToolRequestSchema } = await import('@modelcontextprotocol/sdk/types.js')
    const { __serverState } = await import('@modelcontextprotocol/sdk/server/index.js')
    const server = __serverState.instance
    if (!server) {
      throw new Error('Server instance not initialized')
    }

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
  })
})
