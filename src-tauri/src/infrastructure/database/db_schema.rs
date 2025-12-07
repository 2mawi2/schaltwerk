use super::connection::Database;

pub fn initialize_schema(db: &Database) -> anyhow::Result<()> {
    let conn = db.get_conn()?;

    // Main sessions table - consolidated schema
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                version_group_id TEXT,
                version_number INTEGER,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
            status TEXT NOT NULL,  -- 'active', 'cancelled', or 'spec'
            session_state TEXT DEFAULT 'running',  -- 'spec', 'running', or 'reviewed'
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_activity INTEGER,
            initial_prompt TEXT,
            ready_to_merge BOOLEAN DEFAULT FALSE,
            original_agent_type TEXT,
            original_skip_permissions BOOLEAN,
            pending_name_generation BOOLEAN DEFAULT FALSE,
            was_auto_generated BOOLEAN DEFAULT FALSE,
            spec_content TEXT,
            UNIQUE(repository_path, name)
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo ON sessions(repository_path)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_status ON sessions(status)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_activity ON sessions(last_activity)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_repo_order ON sessions(repository_path, ready_to_merge, last_activity DESC)",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_sessions_status_order ON sessions(status, ready_to_merge, last_activity DESC)",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS git_stats (
            session_id TEXT PRIMARY KEY,
            files_changed INTEGER NOT NULL,
            lines_added INTEGER NOT NULL,
            lines_removed INTEGER NOT NULL,
            has_uncommitted BOOLEAN NOT NULL,
            calculated_at INTEGER NOT NULL,
            FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
        )",
        [],
    )?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS app_config (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            skip_permissions BOOLEAN DEFAULT FALSE,
            agent_type TEXT DEFAULT 'claude',
            orchestrator_skip_permissions BOOLEAN DEFAULT FALSE,
            orchestrator_agent_type TEXT DEFAULT 'claude',
            default_open_app TEXT DEFAULT NULL,
            default_base_branch TEXT,
            terminal_font_size INTEGER DEFAULT 13,
            ui_font_size INTEGER DEFAULT 12,
            dev_error_toasts_enabled BOOLEAN DEFAULT FALSE
        )",
        [],
    )?;

    // Apply migrations for app_config
    apply_app_config_migrations(&conn)?;

    conn.execute(
        "INSERT OR IGNORE INTO app_config (
            id,
            skip_permissions,
            agent_type,
            orchestrator_skip_permissions,
            orchestrator_agent_type,
            default_open_app,
            terminal_font_size,
            ui_font_size,
            tutorial_completed,
            dev_error_toasts_enabled
        ) VALUES (1, FALSE, 'claude', FALSE, 'claude', NULL, 13, 12, FALSE, FALSE)",
        [],
    )?;

    // Apply migrations for sessions table
    apply_sessions_migrations(&conn)?;

    // Specs table (decoupled from sessions)
    conn.execute(
        "CREATE TABLE IF NOT EXISTS specs (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            display_name TEXT,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            content TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            UNIQUE(repository_path, name)
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_specs_repo ON specs(repository_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_specs_name_repo ON specs(repository_path, name)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_specs_updated_at ON specs(updated_at)",
        [],
    )?;

    // Apply migrations for specs table (including legacy spec rows)
    apply_specs_migrations(&conn)?;

    // Create project_config table for project-specific settings
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_config (
            repository_path TEXT PRIMARY KEY,
            setup_script TEXT,
            branch_prefix TEXT DEFAULT 'schaltwerk',
            github_repository TEXT,
            github_default_branch TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;

    // Apply migrations for project_config
    apply_project_config_migrations(&conn)?;

    // Create agent_binaries table for storing agent binary configurations
    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_binaries (
            agent_name TEXT PRIMARY KEY,
            custom_path TEXT,
            auto_detect BOOLEAN NOT NULL DEFAULT TRUE,
            detected_binaries_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        [],
    )?;

    // Archived specs for prompt history/recovery
    conn.execute(
        "CREATE TABLE IF NOT EXISTS archived_specs (
            id TEXT PRIMARY KEY,
            session_name TEXT NOT NULL,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            content TEXT NOT NULL,
            archived_at INTEGER NOT NULL
        )",
        [],
    )?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_archived_specs_repo ON archived_specs(repository_path)",
        [],
    )?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_archived_specs_archived_at ON archived_specs(archived_at)",
        [],
    )?;

    Ok(())
}

/// Apply migrations for the app_config table
fn apply_app_config_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN agent_type TEXT DEFAULT 'claude'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN default_open_app TEXT DEFAULT 'finder'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN orchestrator_skip_permissions BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN orchestrator_agent_type TEXT DEFAULT 'claude'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN default_base_branch TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN terminal_font_size INTEGER DEFAULT 13",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN ui_font_size INTEGER DEFAULT 12",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN tutorial_completed BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN archive_max_entries INTEGER DEFAULT 50",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE app_config ADD COLUMN dev_error_toasts_enabled BOOLEAN DEFAULT FALSE",
        [],
    );
    Ok(())
}

/// Apply migrations for the sessions table
fn apply_sessions_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN ready_to_merge BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_agent_type TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_skip_permissions BOOLEAN",
        [],
    );
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN display_name TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN version_group_id TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN version_number INTEGER", []);
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN pending_name_generation BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN was_auto_generated BOOLEAN DEFAULT FALSE",
        [],
    );
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN spec_content TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN session_state TEXT DEFAULT 'running'",
        [],
    );
    // New: gate agent resume after Spec/Cancel until first fresh start
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN resume_allowed BOOLEAN DEFAULT TRUE",
        [],
    );
    // Store Amp thread ID for resuming threads across sessions
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN amp_thread_id TEXT", []);
    // Store original parent branch (set once at creation, never changes)
    // This allows resetting the compare branch back to the original
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_parent_branch TEXT",
        [],
    );
    // Backfill original_parent_branch from parent_branch for existing sessions
    let _ = conn.execute(
        "UPDATE sessions SET original_parent_branch = parent_branch WHERE original_parent_branch IS NULL",
        [],
    );
    Ok(())
}

/// Apply migrations for the specs table and migrate legacy spec-state sessions.
fn apply_specs_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    let tx = conn.unchecked_transaction()?;

    tx.execute(
        "INSERT INTO specs (id, name, display_name, repository_path, repository_name, content, created_at, updated_at)
         SELECT s.id, s.name, s.display_name,
                s.repository_path, s.repository_name,
                COALESCE(s.spec_content, s.initial_prompt, ''),
                s.created_at, s.updated_at
         FROM sessions s
         WHERE s.session_state = 'spec'
           AND NOT EXISTS (SELECT 1 FROM specs sp WHERE sp.id = s.id)",
        [],
    )?;

    tx.execute("DELETE FROM sessions WHERE session_state = 'spec'", [])?;

    tx.commit()?;
    Ok(())
}

/// Apply migrations for the project_config table
fn apply_project_config_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute(
        "ALTER TABLE project_config DROP COLUMN last_selection_kind",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config DROP COLUMN last_selection_payload",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN sessions_filter_mode TEXT DEFAULT 'all'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN sessions_sort_mode TEXT DEFAULT 'name'",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN environment_variables TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN action_buttons TEXT",
        [],
    );
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN run_script TEXT", []);
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN branch_prefix TEXT",
        [],
    );
    let _ = conn.execute(
        "UPDATE project_config SET branch_prefix = 'schaltwerk' WHERE branch_prefix IS NULL",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN auto_cancel_after_merge INTEGER DEFAULT 0",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN github_repository TEXT",
        [],
    );
    let _ = conn.execute(
        "ALTER TABLE project_config ADD COLUMN github_default_branch TEXT",
        [],
    );
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::apply_specs_migrations;
    use rusqlite::Connection;

    #[test]
    fn specs_migration_does_not_delete_on_insert_failure() {
        let conn = Connection::open_in_memory().unwrap();

        conn.execute(
            "CREATE TABLE sessions (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                branch TEXT NOT NULL,
                parent_branch TEXT NOT NULL,
                worktree_path TEXT NOT NULL,
                status TEXT NOT NULL,
                session_state TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                initial_prompt TEXT,
                spec_content TEXT
            )",
            [],
        )
        .unwrap();

        conn.execute(
            "CREATE TABLE specs (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                display_name TEXT,
                repository_path TEXT NOT NULL,
                repository_name TEXT NOT NULL,
                content TEXT NOT NULL,
                created_at INTEGER NOT NULL,
                updated_at INTEGER NOT NULL,
                UNIQUE(repository_path, name)
            )",
            [],
        )
        .unwrap();

        // Existing spec causes INSERT conflict on (repository_path, name)
        conn.execute(
            "INSERT INTO specs (id, name, display_name, repository_path, repository_name, content, created_at, updated_at)
             VALUES ('spec-existing', 'spec-session', NULL, '/repo', 'repo', 'existing', 0, 0)",
            [],
        )
        .unwrap();

        // Legacy spec row still in sessions
        conn.execute(
            "INSERT INTO sessions (id, name, display_name, repository_path, repository_name, branch, parent_branch, worktree_path, status, session_state, created_at, updated_at, initial_prompt)
             VALUES ('spec-legacy', 'spec-session', NULL, '/repo', 'repo', 'refs/heads/x', 'main', '/tmp/wt', 'active', 'spec', 0, 0, '# prompty')",
            [],
        )
        .unwrap();

        let result = apply_specs_migrations(&conn);
        assert!(
            result.is_err(),
            "migration should surface insert failure to avoid silent deletion"
        );

        let remaining: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM sessions WHERE session_state = 'spec'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(
            remaining, 1,
            "spec rows in sessions must not be deleted on failed insert"
        );
    }
}
