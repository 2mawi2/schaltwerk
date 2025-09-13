use super::connection::Database;

pub fn initialize_schema(db: &Database) -> anyhow::Result<()> {
    let conn = db.conn.lock().unwrap();
    
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
            default_open_app TEXT DEFAULT 'finder',
            default_base_branch TEXT,
            terminal_font_size INTEGER DEFAULT 13,
            ui_font_size INTEGER DEFAULT 12
        )",
        [],
    )?;
    
    // Apply migrations for app_config
    apply_app_config_migrations(&conn)?;
    
    conn.execute(
        "INSERT OR IGNORE INTO app_config (id, skip_permissions, agent_type, default_open_app, terminal_font_size, ui_font_size, tutorial_completed) VALUES (1, FALSE, 'claude', 'finder', 13, 12, FALSE)",
        [],
    )?;

    // Apply migrations for sessions table
    apply_sessions_migrations(&conn)?;
    
    // Create project_config table for project-specific settings
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_config (
            repository_path TEXT PRIMARY KEY,
            setup_script TEXT,
            last_selection_kind TEXT,
            last_selection_payload TEXT,
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
    let _ = conn.execute("ALTER TABLE app_config ADD COLUMN agent_type TEXT DEFAULT 'claude'", []);
    let _ = conn.execute("ALTER TABLE app_config ADD COLUMN default_open_app TEXT DEFAULT 'finder'", []);
    let _ = conn.execute("ALTER TABLE app_config ADD COLUMN default_base_branch TEXT", []);
    let _ = conn.execute("ALTER TABLE app_config ADD COLUMN terminal_font_size INTEGER DEFAULT 13", []);
    let _ = conn.execute("ALTER TABLE app_config ADD COLUMN ui_font_size INTEGER DEFAULT 12", []);
    let _ = conn.execute("ALTER TABLE app_config ADD COLUMN tutorial_completed BOOLEAN DEFAULT FALSE", []);
    let _ = conn.execute("ALTER TABLE app_config ADD COLUMN archive_max_entries INTEGER DEFAULT 50", []);
    Ok(())
}

/// Apply migrations for the sessions table
fn apply_sessions_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN ready_to_merge BOOLEAN DEFAULT FALSE", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN original_agent_type TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN original_skip_permissions BOOLEAN", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN display_name TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN version_group_id TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN version_number INTEGER", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN pending_name_generation BOOLEAN DEFAULT FALSE", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN was_auto_generated BOOLEAN DEFAULT FALSE", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN spec_content TEXT", []);
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN session_state TEXT DEFAULT 'running'", []);
    // New: gate agent resume after Spec/Cancel until first fresh start
    let _ = conn.execute("ALTER TABLE sessions ADD COLUMN resume_allowed BOOLEAN DEFAULT TRUE", []);
    Ok(())
}

/// Apply migrations for the project_config table
fn apply_project_config_migrations(conn: &rusqlite::Connection) -> anyhow::Result<()> {
    // These migrations are idempotent - they silently fail if column already exists
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN last_selection_kind TEXT", []);
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN last_selection_payload TEXT", []);
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN sessions_filter_mode TEXT DEFAULT 'all'", []);
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN sessions_sort_mode TEXT DEFAULT 'name'", []);
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN environment_variables TEXT", []);
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN action_buttons TEXT", []);
    let _ = conn.execute("ALTER TABLE project_config ADD COLUMN run_script TEXT", []);
    Ok(())
}
