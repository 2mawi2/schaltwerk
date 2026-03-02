# Custom Worktree Base Directory - Design

## Problem
Worktree base directory is hardcoded to `<repo_root>/.schaltwerk/worktrees/<session_name>`. No way to override per-project.

## Solution
New nullable `worktree_base_directory` column in `project_config`. When set, new sessions create worktrees at `<resolved_base>/<session_name>`. Accepts absolute and relative paths (resolved against repo root). Stored as-is (not canonicalized) for portability.

## Components
- **DB**: Migration adds `worktree_base_directory TEXT` to `project_config`
- **DB access**: `get/set_project_worktree_base_directory()` on `ProjectConfigMethods`
- **Session utils**: `find_unique_session_paths()` accepts optional base dir
- **Session service**: Reads base dir from DB, passes to utils
- **Tauri commands**: Include in `ProjectSettings` get/set
- **Frontend**: Text input in Settings UI under project settings
- **MCP API**: `GET/PUT /api/project/worktree-base-directory` endpoints
- **MCP server**: `schaltwerk_get_worktree_base_directory` / `schaltwerk_set_worktree_base_directory` tools

## Validation
1. On save: resolve path, check exists + writable, store raw path
2. On session create: re-resolve and re-validate
3. Empty string = clear (NULL)

## Scope boundaries
- Orphan cleanup still only scans `.schaltwerk/worktrees/`
- Existing sessions unaffected (paths stored per-session)
- Clearing setting reverts to default for new sessions
