# OpenCode MCP Registration Implementation Plan

## Overview
This plan outlines the implementation of MCP registration support for OpenCode in Schaltwerk settings, similar to the existing implementations for Claude Code and Codex.

## Research Findings

### OpenCode MCP Integration
- OpenCode uses a configuration file approach (`opencode.json`) rather than CLI commands
- MCP servers are defined under the `mcp` section in the config file
- Each MCP server has a name, type (local/remote), command, and other configuration options
- Unlike Claude and Codex, OpenCode doesn't have specific CLI commands for MCP management

### Current Implementation Analysis
- **Backend**: `src-tauri/src/commands/mcp_config.rs` handles MCP configuration for Claude and Codex
- **Frontend**: `src/components/settings/MCPConfigPanel.tsx` provides the UI for MCP configuration
- **Settings**: `src/components/modals/SettingsModal.tsx` includes MCP configuration in the Agent Configuration tab

## Implementation Strategy

### 1. Backend Changes (`src-tauri/src/commands/mcp_config.rs`)

#### Add OpenCode Client Support
- Add `OpenCode` variant to the `McpClient` enum
- Implement OpenCode-specific configuration logic
- Create functions for:
  - `configure_mcp_opencode()` - Creates/updates `opencode.json` config
  - `remove_mcp_opencode()` - Removes Schaltwerk from `opencode.json`
  - `check_opencode_config_status()` - Checks if Schaltwerk is configured

#### OpenCode Configuration Logic
```rust
// opencode.json structure:
{
  "mcp": {
    "schaltwerk": {
      "type": "local",
      "command": ["node", "/path/to/schaltwerk-mcp-server.js"],
      "enabled": true
    }
  }
}
```

### 2. Frontend Changes

#### Update MCPConfigPanel (`src/components/settings/MCPConfigPanel.tsx`)
- Add `opencode` to the `Props.agent` type
- Update the UI text and descriptions for OpenCode
- Modify configuration logic to handle OpenCode's config file approach
- Add OpenCode-specific setup instructions

#### Update SettingsModal (`src/components/modals/SettingsModal.tsx`)
- Add OpenCode to the agent tabs in the environment settings
- Include OpenCode MCP configuration panel
- Update agent-specific help text and examples

### 3. Configuration File Management

#### OpenCode Config Location
- Primary: Project-specific `opencode.json` (if exists)
- Fallback: Global `~/.opencode/config.json`
- User-specific: `~/.config/opencode/config.json`

#### Configuration Strategy
1. Check for project-specific `opencode.json`
2. If not found, use global config
3. Create project-specific config if user prefers
4. Update existing config with Schaltwerk MCP server entry

### 4. User Experience

#### One-Click Installation
- Similar to Claude/Codex: "Configure MCP for This Project" button
- Automatically detects OpenCode installation
- Creates appropriate configuration file
- Provides clear success/error feedback

#### Manual Setup Instructions
- Show config file location and required entries
- Provide copy-to-clipboard functionality
- Include examples for both project and global configs

### 5. Error Handling

#### OpenCode Detection
- Check if `opencode` CLI is available
- Handle cases where OpenCode is not installed
- Provide installation instructions if needed

#### Configuration File Issues
- Handle missing config files gracefully
- Provide backup configuration options
- Clear error messages for common issues

## Implementation Steps

### Phase 1: Backend Implementation
1. Add OpenCode client support to `McpClient` enum
2. Implement OpenCode configuration functions
3. Add OpenCode-specific status checking
4. Update command routing in `main.rs`

### Phase 2: Frontend Implementation
1. Update `MCPConfigPanel` to support OpenCode
2. Add OpenCode tab to SettingsModal
3. Update UI text and help content
4. Test configuration flow

### Phase 3: Testing and Validation
1. Test OpenCode MCP registration
2. Verify configuration file creation
3. Test error handling scenarios
4. Validate user experience

## Files to Modify

### Backend Files
- `src-tauri/src/commands/mcp_config.rs` - Main MCP configuration logic
- `src-tauri/src/main.rs` - Command routing

### Frontend Files
- `src/components/settings/MCPConfigPanel.tsx` - MCP configuration UI
- `src/components/modals/SettingsModal.tsx` - Settings modal
- `src/common/tauriCommands.ts` - Command definitions (if needed)

## Success Criteria

1. **One-Click Installation**: Users can click "Configure MCP" and have OpenCode configured automatically
2. **Proper Configuration**: Generated config files follow OpenCode's expected format
3. **Error Handling**: Clear error messages for common issues
4. **User Guidance**: Helpful instructions for manual setup if needed
5. **Consistency**: Similar user experience to Claude and Codex implementations

## Potential Challenges

1. **Config File Location**: Determining the correct location for OpenCode config files
2. **Existing Configurations**: Handling cases where users already have MCP servers configured
3. **File Permissions**: Ensuring write access to configuration files
4. **OpenCode Versions**: Compatibility with different versions of OpenCode

## Testing Plan

1. Test with fresh OpenCode installation
2. Test with existing OpenCode configuration
3. Test error scenarios (no OpenCode installed, permission issues)
4. Test configuration file creation and updates
5. Validate MCP server functionality after configuration