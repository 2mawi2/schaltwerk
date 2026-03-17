use rusqlite::{Connection, OpenFlags, params};
use std::path::Path;

use super::kilo::KilocodeSessionInfo;

pub fn find_kilo_session_in_db(worktree_path: &Path, home: &Path) -> Option<KilocodeSessionInfo> {
    let db_path = home.join(".local/share/kilo/kilo.db");
    if !db_path.exists() {
        log::debug!(
            "Kilo DB not found at '{}'",
            db_path.display()
        );
        return None;
    }

    let conn = match Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY) {
        Ok(c) => c,
        Err(err) => {
            log::debug!("Failed to open Kilo DB: {err}");
            return None;
        }
    };

    let repo_root = super::kilo::extract_repo_root(worktree_path)
        .unwrap_or_else(|| worktree_path.to_path_buf());
    let repo_root_str = repo_root.to_string_lossy().to_string();
    let worktree_str = worktree_path.to_string_lossy().to_string();

    log::debug!("Kilo DB lookup: worktree='{worktree_str}', repo_root='{repo_root_str}'");

    if let Some(info) = find_by_directory(&conn, &worktree_str) {
        return Some(info);
    }

    find_by_project(&conn, &repo_root_str, &worktree_str)
}

fn find_by_directory(conn: &Connection, worktree_str: &str) -> Option<KilocodeSessionInfo> {
    let mut stmt = conn
        .prepare(
            "SELECT s.id, (SELECT count(*) FROM message m WHERE m.session_id = s.id) as msg_count
             FROM session s
             WHERE s.directory = ?1
             ORDER BY s.time_updated DESC
             LIMIT 1",
        )
        .ok()?;

    let result = stmt
        .query_row(params![worktree_str], |row| {
            let id: String = row.get(0)?;
            let msg_count: i64 = row.get(1)?;
            Ok((id, msg_count))
        })
        .ok()?;

    log::info!(
        "Kilo DB: found session '{}' by directory match ({} messages)",
        result.0,
        result.1
    );

    Some(KilocodeSessionInfo {
        id: result.0,
        has_history: result.1 > 2,
    })
}

fn find_by_project(
    conn: &Connection,
    repo_root_str: &str,
    worktree_str: &str,
) -> Option<KilocodeSessionInfo> {
    let mut project_stmt = conn
        .prepare("SELECT id FROM project WHERE worktree = ?1")
        .ok()?;

    let project_ids: Vec<String> = project_stmt
        .query_map(params![repo_root_str], |row| row.get(0))
        .ok()?
        .filter_map(|r| r.ok())
        .collect();

    if project_ids.is_empty() {
        log::debug!(
            "Kilo DB: no project matched repo root '{repo_root_str}'"
        );
        return None;
    }

    for project_id in &project_ids {
        let mut stmt = conn
            .prepare(
                "SELECT s.id, s.directory,
                        (SELECT count(*) FROM message m WHERE m.session_id = s.id) as msg_count
                 FROM session s
                 WHERE s.project_id = ?1
                 ORDER BY s.time_updated DESC",
            )
            .ok()?;

        let sessions: Vec<(String, String, i64)> = stmt
            .query_map(params![project_id], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?))
            })
            .ok()?
            .filter_map(|r| r.ok())
            .collect();

        for (id, directory, msg_count) in &sessions {
            if directory == worktree_str && *msg_count > 2 {
                log::info!(
                    "Kilo DB: found session '{id}' via project '{project_id}' directory match ({msg_count} messages)"
                );
                return Some(KilocodeSessionInfo {
                    id: id.clone(),
                    has_history: true,
                });
            }
        }

        let worktree_prefix = format!("{}/", repo_root_str.trim_end_matches('/'));
        for (id, directory, msg_count) in &sessions {
            if directory.starts_with(&worktree_prefix) && *msg_count > 2 {
                let suffix = &directory[worktree_prefix.len()..];
                let worktree_suffix = if worktree_str.starts_with(&worktree_prefix) {
                    &worktree_str[worktree_prefix.len()..]
                } else {
                    ""
                };
                if suffix == worktree_suffix {
                    log::info!(
                        "Kilo DB: found session '{id}' via project prefix match ({msg_count} messages)"
                    );
                    return Some(KilocodeSessionInfo {
                        id: id.clone(),
                        has_history: true,
                    });
                }
            }
        }

    }

    log::debug!(
        "Kilo DB: no sessions found for any matching project"
    );
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    fn create_test_db(dir: &Path) -> Connection {
        let db_path = dir.join(".local/share/kilo/kilo.db");
        std::fs::create_dir_all(db_path.parent().unwrap()).unwrap();

        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE project (
                id TEXT PRIMARY KEY,
                worktree TEXT NOT NULL,
                vcs TEXT,
                name TEXT,
                icon_url TEXT,
                icon_color TEXT,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                time_initialized INTEGER,
                sandboxes TEXT NOT NULL,
                commands TEXT
            );
            CREATE TABLE session (
                id TEXT PRIMARY KEY,
                project_id TEXT NOT NULL,
                parent_id TEXT,
                slug TEXT NOT NULL,
                directory TEXT NOT NULL,
                title TEXT NOT NULL,
                version TEXT NOT NULL,
                share_url TEXT,
                summary_additions INTEGER,
                summary_deletions INTEGER,
                summary_files INTEGER,
                summary_diffs TEXT,
                revert TEXT,
                permission TEXT,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                time_compacting INTEGER,
                time_archived INTEGER,
                workspace_id TEXT,
                FOREIGN KEY (project_id) REFERENCES project(id) ON DELETE CASCADE
            );
            CREATE TABLE message (
                id TEXT PRIMARY KEY,
                session_id TEXT NOT NULL,
                time_created INTEGER NOT NULL,
                time_updated INTEGER NOT NULL,
                data TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES session(id) ON DELETE CASCADE
            );",
        )
        .unwrap();
        conn
    }

    fn insert_project(conn: &Connection, id: &str, worktree: &str) {
        conn.execute(
            "INSERT INTO project (id, worktree, time_created, time_updated, sandboxes)
             VALUES (?1, ?2, 100, 200, '[]')",
            params![id, worktree],
        )
        .unwrap();
    }

    fn insert_session(
        conn: &Connection,
        id: &str,
        project_id: &str,
        directory: &str,
        time_updated: i64,
    ) {
        conn.execute(
            "INSERT INTO session (id, project_id, slug, directory, title, version, time_created, time_updated)
             VALUES (?1, ?2, 'slug', ?3, 'title', '1.0', 100, ?4)",
            params![id, project_id, directory, time_updated],
        )
        .unwrap();
    }

    fn insert_messages(conn: &Connection, session_id: &str, count: usize) {
        for i in 0..count {
            conn.execute(
                "INSERT INTO message (id, session_id, time_created, time_updated, data)
                 VALUES (?1, ?2, 100, 200, '{}')",
                params![format!("msg_{}_{}", session_id, i), session_id],
            )
            .unwrap();
        }
    }

    #[test]
    fn test_db_find_by_exact_directory() {
        let temp = TempDir::new().unwrap();
        let conn = create_test_db(temp.path());

        let repo_root = "/Users/test/project";
        let worktree = "/Users/test/project/.schaltwerk/worktrees/my_session";
        insert_project(&conn, "proj1", repo_root);
        insert_session(&conn, "ses1", "proj1", worktree, 300);
        insert_messages(&conn, "ses1", 5);
        drop(conn);

        let worktree_path = Path::new(worktree);
        let result = find_kilo_session_in_db(worktree_path, temp.path());
        let info = result.expect("expected session info");
        assert_eq!(info.id, "ses1");
        assert!(info.has_history);
    }

    #[test]
    fn test_db_no_fallback_to_unrelated_worktree() {
        let temp = TempDir::new().unwrap();
        let conn = create_test_db(temp.path());

        let repo_root = "/Users/test/project";
        let worktree = "/Users/test/project/.schaltwerk/worktrees/my_session";
        let temp_dir = "/tmp/some_temp_dir";
        insert_project(&conn, "proj1", repo_root);
        insert_session(&conn, "ses1", "proj1", temp_dir, 300);
        insert_messages(&conn, "ses1", 5);
        drop(conn);

        let worktree_path = std::path::PathBuf::from(worktree);
        let result = find_kilo_session_in_db(&worktree_path, temp.path());
        assert!(
            result.is_none(),
            "should not return sessions from unrelated worktrees"
        );
    }

    #[test]
    fn test_db_no_match() {
        let temp = TempDir::new().unwrap();
        let conn = create_test_db(temp.path());

        insert_project(&conn, "proj1", "/Users/test/other_project");
        insert_session(&conn, "ses1", "proj1", "/some/dir", 300);
        insert_messages(&conn, "ses1", 5);
        drop(conn);

        let worktree = Path::new("/Users/test/project/.schaltwerk/worktrees/my_session");
        let result = find_kilo_session_in_db(worktree, temp.path());
        assert!(result.is_none());
    }

    #[test]
    fn test_db_no_db_file() {
        let temp = TempDir::new().unwrap();
        let worktree = Path::new("/Users/test/project/.schaltwerk/worktrees/my_session");
        let result = find_kilo_session_in_db(worktree, temp.path());
        assert!(result.is_none());
    }

    #[test]
    fn test_db_few_messages_no_history() {
        let temp = TempDir::new().unwrap();
        let conn = create_test_db(temp.path());

        let worktree = "/Users/test/project/.schaltwerk/worktrees/my_session";
        insert_project(&conn, "proj1", "/Users/test/project");
        insert_session(&conn, "ses1", "proj1", worktree, 300);
        insert_messages(&conn, "ses1", 2);
        drop(conn);

        let result = find_kilo_session_in_db(Path::new(worktree), temp.path());
        let info = result.expect("expected session info");
        assert_eq!(info.id, "ses1");
        assert!(!info.has_history);
    }

    #[test]
    fn test_db_picks_most_recent_session() {
        let temp = TempDir::new().unwrap();
        let conn = create_test_db(temp.path());

        let worktree = "/Users/test/project/.schaltwerk/worktrees/my_session";
        insert_project(&conn, "proj1", "/Users/test/project");
        insert_session(&conn, "ses_old", "proj1", worktree, 100);
        insert_messages(&conn, "ses_old", 5);
        insert_session(&conn, "ses_new", "proj1", worktree, 300);
        insert_messages(&conn, "ses_new", 5);
        drop(conn);

        let result = find_kilo_session_in_db(Path::new(worktree), temp.path());
        let info = result.expect("expected most recent session");
        assert_eq!(info.id, "ses_new");
    }
}
