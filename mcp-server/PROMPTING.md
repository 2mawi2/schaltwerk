# Schaltwerk MCP Server - Prompting Guide

This guide helps AI assistants effectively use the Schaltwerk MCP server for managing development sessions.

## System Prompt for AI Assistants

When the Schaltwerk MCP server is available, you can manage development sessions directly. Here's how to use it effectively:

### Session Management Capabilities

You have access to tools for managing Schaltwerk sessions:

1. **schaltwerk_create** - Create new isolated development sessions
2. **schaltwerk_list** - View all sessions with their review status
3. **schaltwerk_cancel** - Remove abandoned sessions

### Creating Effective Sessions

When creating sessions with `schaltwerk_create`, follow these guidelines:

#### Good Session Names
- Use descriptive, hyphenated names: `user-auth`, `api-endpoints`, `fix-login-bug`
- Keep names under 30 characters
- Use only alphanumeric, hyphens, and underscores

#### Good Initial Prompts
Be specific and detailed in your prompts:

✅ **GOOD PROMPTS:**
- "Implement user authentication with JWT tokens, including login, logout, and password reset functionality"
- "Fix the bug where users cannot log in with email addresses containing special characters"
- "Add REST API endpoints for CRUD operations on the Product model with proper validation"
- "Refactor the payment processing module to use the Strategy pattern for different payment providers"

❌ **BAD PROMPTS:**
- "Fix bug"
- "Add feature"
- "Make it work"
- "Update code"

#### Agent Type Selection
- Use `"claude"` for general development agents (default)
- Use `"cursor"` when Cursor IDE integration is preferred
- Set `skip_permissions: true` for fully autonomous operation

### Monitoring Sessions

Use `schaltwerk_list` to monitor session status:

```javascript
// Get human-readable list
schaltwerk_list()

// Get JSON for parsing
schaltwerk_list({ json: true })
```

Look for:
- **[NEW]** - Sessions needing review
- **[REVIEWED]** - Sessions ready to merge
- Agent type used for each session
- Last modification time

### Best Practices

1. **Parallel Development**: Create multiple sessions for different features
2. **Clear Naming**: Use descriptive session names that reflect the work
3. **Detailed Prompts**: Provide comprehensive context in initial prompts
4. **Regular Monitoring**: Check session status periodically
5. **Cleanup**: Cancel abandoned sessions to keep workspace clean

### Example Workflows

#### Starting a New Feature
```
"I'll create a new Schaltwerk session for the authentication feature."
Use: schaltwerk_create(
  name: "user-authentication",
  prompt: "Implement complete user authentication system with registration, login, JWT tokens, password reset via email, and session management",
  agent_type: "claude"
)
```

#### Managing Multiple Sessions
```
"Let me check the status of all development sessions."
Use: schaltwerk_list()

"I see there are 3 new sessions and 2 reviewed ones. Let me get details."
Use: schaltwerk_list({ json: true })
```

#### Cleaning Up
```
"This experimental session is no longer needed. I'll remove it."
Use: schaltwerk_cancel(session_name: "experiment-feature")
```

## Prompt Templates for Common Agents

### Feature Development
```
Create a session for [FEATURE]:
- Break down the feature into components
- Implement with test coverage
- Follow existing code patterns
- Document as needed

schaltwerk_create(
  name: "[feature-name]",
  prompt: "Implement [FEATURE] including [SPECIFIC REQUIREMENTS]. Ensure proper error handling, validation, and test coverage."
)
```

### Bug Fixes
```
Create a session to fix [BUG]:
- Identify root cause
- Implement fix
- Add regression tests
- Verify no side effects

schaltwerk_create(
  name: "fix-[bug-identifier]",
  prompt: "Fix the bug where [SPECIFIC BUG DESCRIPTION]. Add tests to prevent regression."
)
```

### Refactoring
```
Create a session for refactoring [MODULE]:
- Maintain functionality
- Improve code quality
- Ensure tests pass
- Document changes

schaltwerk_create(
  name: "refactor-[module]",
  prompt: "Refactor [MODULE] to [IMPROVEMENT GOAL] while maintaining all existing functionality and tests."
)
```

## Integration with Orchestrator Pattern

When acting as an orchestrator managing multiple AI agents:

1. **Create Sessions for Each Agent**
   ```
   schaltwerk_create(name: "agent1-agent", prompt: "...", skip_permissions: true)
   schaltwerk_create(name: "agent2-agent", prompt: "...", skip_permissions: true)
   ```

2. **Monitor Progress**
   ```
   schaltwerk_list({ json: true }) // Parse and track status
   ```

3. **Coordinate Work**
   - Check for reviewed sessions ready to merge
   - Identify blocked or failed sessions
   - Clean up completed work

4. **Cleanup**
   ```
   schaltwerk_cancel(session_name: "completed-agent")
   ```

## Error Handling

Common errors and solutions:

- **"Session already exists"**: Use a different name or cancel the existing session first
- **"Repository not found"**: Ensure you're in a Git repository
- **"Database connection failed"**: Check that Schaltwerk app has been run at least once
- **"Branch creation failed"**: Verify the base branch exists and you have permissions

## Resources

Access session data programmatically:

- `schaltwerk://sessions` - Full session list with metadata
- `schaltwerk://sessions/reviewed` - Only reviewed sessions
- `schaltwerk://sessions/new` - Only unreviewed sessions

Use these resources to build custom workflows and monitoring.