import * as fs from 'fs'
import * as path from 'path'

describe('MCP tool registry', () => {
  it('exposes spec-first create command name', () => {
    const serverPath = path.join(__dirname, '../src/schaltwerk-mcp-server.ts')
    const content = fs.readFileSync(serverPath, 'utf8')

    expect(content).toContain('name: "schaltwerk_spec_create"')
  })
})
