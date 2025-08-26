# Schaltwerk MCP Server

This is the Model Context Protocol (MCP) server for Schaltwerk, enabling AI assistants to manage Schaltwerk sessions programmatically.

## Features

- **Create Sessions**: Start new development sessions with Git worktrees
- **List Sessions**: View all sessions with review status
- **Cancel Sessions**: Remove abandoned sessions
- **Review Status**: Track which sessions are reviewed vs new

## Installation

### Quick Setup (Recommended)

From the schaltwerk repository root:

```bash
just mcp-setup
```

This command will:
1. Install dependencies
2. Build the MCP server
3. Display the exact registration command with the correct path

Then follow the displayed instructions to register with Claude Code.

### Manual Installation

If you prefer to set up manually:

#### 1. Build the MCP Server

```bash
cd mcp-server
npm install
npm run build
```

#### 2. Configure Claude Code (CLI)

Since the commander runs Claude Code CLI (not Claude Desktop), configure it using one of these methods:

##### Option 1: CLI Command (Recommended)
```bash
claude mcp add --transport stdio --scope project schaltwerk node /path/to/schaltwerk/mcp-server/build/schaltwerk-mcp-server.js
```

##### Option 2: Manual Configuration
Add to `.claude.json` in your project root:

```json
{
  "mcpServers": {
    "schaltwerk": {
      "type": "stdio",
      "command": "node",
      "args": ["/path/to/schaltwerk/mcp-server/build/schaltwerk-mcp-server.js"]
    }
  }
}
```

Replace `/path/to/schaltwerk` with the actual path to your schaltwerk repository.

### 3. Restart Commander

Use the Settings modal (⌘,) in Schaltwerk to restart the commander and reload the MCP configuration.

## Usage

Once configured, Claude can use the following tools:

### Creating Sessions

```
Use schaltwerk_create to start a new session:
- name: "feature-auth" 
- prompt: "implement user authentication with JWT"
- agent_type: "claude" (or "cursor")
- base_branch: "main" (optional)
- skip_permissions: true (for autonomous operation)
```

### Listing Sessions

```
Use schaltwerk_list to see all sessions:
- Shows review status ([NEW] or [REVIEWED])
- Shows last modified time
- Shows agent type used
- Use json: true for structured output
```

### Cancelling Sessions

```
Use schaltwerk_cancel to remove a session:
- session_name: "feature-auth"
- WARNING: This deletes all uncommitted work
```

## Resources

The MCP server also exposes resources you can read:

- `schaltwerk://sessions` - All active sessions
- `schaltwerk://sessions/reviewed` - Only reviewed sessions
- `schaltwerk://sessions/new` - Only new (unreviewed) sessions

## Development

### Running in Development Mode

```bash
cd mcp-server
npm run dev  # Watch mode for TypeScript
node build/schaltwerk-mcp-server.js  # Run the server
```

### Testing

```bash
npm test
```

## Architecture

The MCP server communicates directly with the Schaltwerk SQLite database to manage sessions. It:

1. Reads session data from `~/Library/Application Support/schaltwerk/sessions.db`
2. Creates Git worktrees for new sessions
3. Updates session metadata in the database
4. Manages review status tracking

## Troubleshooting

### Server Not Starting

1. Check that the database exists at the expected location
2. Ensure you have Git installed and configured
3. Verify the repository path is correct

### Sessions Not Creating

1. Ensure you're in a Git repository
2. Check that the base branch exists
3. Verify you have write permissions

### Claude Not Finding the Server

1. Check the configuration file path is correct
2. Ensure the MCP server path is absolute, not relative
3. Restart Claude Desktop after configuration changes