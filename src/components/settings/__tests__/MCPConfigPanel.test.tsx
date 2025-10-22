import { render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, test, vi } from 'vitest'
import { MCPConfigPanel } from '../MCPConfigPanel'
import { invoke } from '@tauri-apps/api/core'
import { TauriCommands } from '../../../common/tauriCommands'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

describe('MCPConfigPanel', () => {
  const invokeMock = vi.mocked(invoke)

  beforeEach(() => {
    vi.clearAllMocks()
  })

  test('shows Node.js installation warning when Node.js is unavailable', async () => {
    invokeMock.mockImplementation((command, _args) => {
      if (command === TauriCommands.GetMcpStatus) {
        return Promise.resolve({
          mcp_server_path: '/Applications/Schaltwerk.app/Contents/Resources/mcp-server/build/schaltwerk-mcp-server.js',
          is_embedded: true,
          cli_available: true,
          node_command: '/Users/example/.local/state/fnm_multishells/node',
          client: 'codex',
          is_configured: true,
          setup_command: 'node /Applications/Schaltwerk.app/Contents/Resources/mcp-server/build/schaltwerk-mcp-server.js',
          project_path: '/Users/example/project',
          node_available: false
        }) as ReturnType<typeof invoke>
      }

      return Promise.reject(new Error(`Unexpected command: ${String(command)}`)) as ReturnType<
        typeof invoke
      >
    })

    render(<MCPConfigPanel projectPath="/Users/example/project" agent="codex" />)

    await waitFor(() =>
      expect(
        screen.getByText('Node.js is required to run the Schaltwerk MCP server.')
      ).toBeInTheDocument()
    )

    expect(
      screen.getByText('Install Node.js and restart Codex to enable MCP tools.')
    ).toBeInTheDocument()
  })
})
