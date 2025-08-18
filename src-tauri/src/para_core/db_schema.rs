use rusqlite::params;
use crate::para_core::database::Database;

pub fn initialize_schema(db: &Database) -> anyhow::Result<()> {
    let conn = db.conn.lock().unwrap();
    
    conn.execute(
        "CREATE TABLE IF NOT EXISTS sessions (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            display_name TEXT,
            repository_path TEXT NOT NULL,
            repository_name TEXT NOT NULL,
            branch TEXT NOT NULL,
            parent_branch TEXT NOT NULL,
            worktree_path TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL,
            last_activity INTEGER,
            initial_prompt TEXT,
            ready_to_merge BOOLEAN DEFAULT FALSE,
            original_agent_type TEXT,
            original_skip_permissions BOOLEAN,
            pending_name_generation BOOLEAN DEFAULT FALSE,
            was_auto_generated BOOLEAN DEFAULT FALSE,
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
    
    // Handle migration: Add agent_type column if it doesn't exist
    let column_exists = {
        let result = conn.prepare("SELECT agent_type FROM app_config LIMIT 1");
        match result {
            Ok(mut stmt) => stmt.query([]).is_ok(),
            Err(_) => false,
        }
    };
    
    if !column_exists {
        conn.execute("ALTER TABLE app_config ADD COLUMN agent_type TEXT DEFAULT 'claude'", [])?;
    }
    
    // Migration: Add default_open_app column if it doesn't exist
    let default_open_app_exists = {
        let result = conn.prepare("SELECT default_open_app FROM app_config LIMIT 1");
        match result {
            Ok(mut stmt) => stmt.query([]).is_ok(),
            Err(_) => false,
        }
    };
    if !default_open_app_exists {
        let _ = conn.execute("ALTER TABLE app_config ADD COLUMN default_open_app TEXT DEFAULT 'finder'", []);
    }
    
    // Migration: Add default_base_branch column if it doesn't exist
    let default_base_branch_exists = {
        let result = conn.prepare("SELECT default_base_branch FROM app_config LIMIT 1");
        match result {
            Ok(mut stmt) => stmt.query([]).is_ok(),
            Err(_) => false,
        }
    };
    if !default_base_branch_exists {
        let _ = conn.execute("ALTER TABLE app_config ADD COLUMN default_base_branch TEXT", []);
    }
    
    // Migration: Add terminal_font_size and ui_font_size columns if they don't exist
    let terminal_font_size_exists = {
        let result = conn.prepare("SELECT terminal_font_size FROM app_config LIMIT 1");
        result.is_ok()
    };
    
    if !terminal_font_size_exists {
        // Check if old font_size column exists and migrate
        let old_font_size_exists = {
            let result = conn.prepare("SELECT font_size FROM app_config LIMIT 1");
            result.is_ok()
        };
        
        if old_font_size_exists {
            // Migrate from old font_size to new columns
            let old_size: rusqlite::Result<i32> = conn.query_row(
                "SELECT font_size FROM app_config WHERE id = 1",
                [],
                |row| row.get(0),
            );
            
            let font_value = old_size.unwrap_or(13);
            let ui_value = if font_value == 13 { 12 } else { font_value - 1 };
            
            conn.execute("ALTER TABLE app_config ADD COLUMN terminal_font_size INTEGER", [])?;
            conn.execute("ALTER TABLE app_config ADD COLUMN ui_font_size INTEGER", [])?;
            conn.execute(
                "UPDATE app_config SET terminal_font_size = ?1, ui_font_size = ?2 WHERE id = 1",
                params![font_value, ui_value],
            )?;
        } else {
            conn.execute("ALTER TABLE app_config ADD COLUMN terminal_font_size INTEGER DEFAULT 13", [])?;
            conn.execute("ALTER TABLE app_config ADD COLUMN ui_font_size INTEGER DEFAULT 12", [])?;
        }
    }
    
    conn.execute(
        "INSERT OR IGNORE INTO app_config (id, skip_permissions, agent_type, default_open_app, terminal_font_size, ui_font_size) VALUES (1, FALSE, 'claude', 'finder', 13, 12)",
        [],
    )?;
    
    // Add ready_to_merge column if it doesn't exist (migration)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN ready_to_merge BOOLEAN DEFAULT FALSE",
        [],
    );
    // Add original_agent_type column if it doesn't exist (migration)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_agent_type TEXT",
        [],
    );
    // Add original_skip_permissions column if it doesn't exist (migration)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN original_skip_permissions BOOLEAN",
        [],
    );
    // Add display_name column if it doesn't exist (migration)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN display_name TEXT",
        [],
    );
    // Add pending_name_generation column if it doesn't exist (migration)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN pending_name_generation BOOLEAN DEFAULT FALSE",
        [],
    );
    // Add was_auto_generated column if it doesn't exist (migration)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN was_auto_generated BOOLEAN DEFAULT FALSE",
        [],
    );
    // Add draft_content column if it doesn't exist (migration)
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN draft_content TEXT",
        [],
    );
    // Add session_state column if it doesn't exist (migration), default to 'running' for backward compatibility
    let _ = conn.execute(
        "ALTER TABLE sessions ADD COLUMN session_state TEXT DEFAULT 'running'",
        [],
    );
    
    // Create project_config table for project-specific settings
    conn.execute(
        "CREATE TABLE IF NOT EXISTS project_config (
            repository_path TEXT PRIMARY KEY,
            setup_script TEXT,
            created_at INTEGER NOT NULL,
            updated_at INTEGER NOT NULL
        )",
        [],
    )?;
    
    Ok(())
}