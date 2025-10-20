use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
use crate::schaltwerk_core::database::Database;
use anyhow::Result;
use chrono::{TimeZone, Utc};
use rusqlite::{params, Result as SqlResult, ToSql};
use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::str::FromStr;
use std::time::Instant;

pub trait SessionMethods {
    fn create_session(&self, session: &Session) -> Result<()>;
    fn get_session_by_name(&self, repo_path: &Path, name: &str) -> Result<Session>;
    fn get_session_by_id(&self, id: &str) -> Result<Session>;
    fn get_session_task_content(
        &self,
        repo_path: &Path,
        name: &str,
    ) -> Result<(Option<String>, Option<String>, SessionState)>;
    fn list_sessions(&self, repo_path: &Path) -> Result<Vec<Session>>;
    fn list_all_active_sessions(&self) -> Result<Vec<Session>>;
    fn list_sessions_by_state(&self, repo_path: &Path, state: SessionState)
        -> Result<Vec<Session>>;
    fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()>;
    fn set_session_activity(
        &self,
        id: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
    ) -> Result<()>;
    fn update_session_display_name(&self, id: &str, display_name: &str) -> Result<()>;
    fn update_session_branch(&self, id: &str, new_branch: &str) -> Result<()>;
    fn update_session_parent_branch(&self, id: &str, new_parent_branch: &str) -> Result<()>;
    fn update_session_ready_to_merge(&self, id: &str, ready: bool) -> Result<()>;
    fn update_session_state(&self, id: &str, state: SessionState) -> Result<()>;
    fn update_spec_content(&self, id: &str, content: &str) -> Result<()>;
    fn append_spec_content(&self, id: &str, content: &str) -> Result<()>;
    fn update_session_initial_prompt(&self, id: &str, prompt: &str) -> Result<()>;
    fn set_pending_name_generation(&self, id: &str, pending: bool) -> Result<()>;
    fn set_session_original_settings(
        &self,
        session_id: &str,
        agent_type: &str,
        skip_permissions: bool,
    ) -> Result<()>;
    fn clear_session_run_state(&self, session_id: &str) -> Result<()>;
    fn set_session_resume_allowed(&self, id: &str, allowed: bool) -> Result<()>;
    fn rename_draft_session(&self, repo_path: &Path, old_name: &str, new_name: &str) -> Result<()>;
    fn set_session_version_info(
        &self,
        id: &str,
        group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()>;
}

const SQLITE_MAX_VARIABLE_NUMBER: usize = 999;

#[derive(Debug, Clone)]
struct SessionSummaryRow {
    id: String,
    name: String,
    display_name: Option<String>,
    version_group_id: Option<String>,
    version_number: Option<i32>,
    repository_path: PathBuf,
    repository_name: String,
    branch: String,
    parent_branch: String,
    worktree_path: PathBuf,
    status: SessionStatus,
    created_at: chrono::DateTime<Utc>,
    updated_at: chrono::DateTime<Utc>,
    last_activity: Option<chrono::DateTime<Utc>>,
    ready_to_merge: bool,
    original_agent_type: Option<String>,
    original_skip_permissions: Option<bool>,
    pending_name_generation: bool,
    was_auto_generated: bool,
    session_state: SessionState,
    resume_allowed: bool,
}

impl Database {
    fn hydrate_session_summaries(
        &self,
        conn: &rusqlite::Connection,
        summaries: Vec<SessionSummaryRow>,
    ) -> Result<Vec<Session>> {
        if summaries.is_empty() {
            return Ok(Vec::new());
        }

        let mut all_ids = Vec::with_capacity(summaries.len());
        let mut spec_ids = Vec::new();
        for summary in &summaries {
            all_ids.push(summary.id.clone());
            if summary.session_state == SessionState::Spec {
                spec_ids.push(summary.id.clone());
            }
        }

        let initial_prompts = Self::fetch_text_column_with_conn(conn, &all_ids, "initial_prompt")?;
        let spec_contents = Self::fetch_text_column_with_conn(conn, &spec_ids, "spec_content")?;

        Ok(summaries
            .into_iter()
            .map(|summary| {
                let initial_prompt = initial_prompts.get(&summary.id).cloned().unwrap_or(None);
                let spec_content = spec_contents.get(&summary.id).cloned().unwrap_or(None);

                Session {
                    id: summary.id,
                    name: summary.name,
                    display_name: summary.display_name,
                    version_group_id: summary.version_group_id,
                    version_number: summary.version_number,
                    repository_path: summary.repository_path,
                    repository_name: summary.repository_name,
                    branch: summary.branch,
                    parent_branch: summary.parent_branch,
                    worktree_path: summary.worktree_path,
                    status: summary.status,
                    created_at: summary.created_at,
                    updated_at: summary.updated_at,
                    last_activity: summary.last_activity,
                    initial_prompt,
                    ready_to_merge: summary.ready_to_merge,
                    original_agent_type: summary.original_agent_type,
                    original_skip_permissions: summary.original_skip_permissions,
                    pending_name_generation: summary.pending_name_generation,
                    was_auto_generated: summary.was_auto_generated,
                    spec_content,
                    session_state: summary.session_state,
                    resume_allowed: summary.resume_allowed,
                }
            })
            .collect())
    }

    fn fetch_text_column_with_conn(
        conn: &rusqlite::Connection,
        ids: &[String],
        column: &str,
    ) -> Result<HashMap<String, Option<String>>> {
        let mut values = HashMap::new();
        if ids.is_empty() {
            return Ok(values);
        }

        for chunk in ids.chunks(SQLITE_MAX_VARIABLE_NUMBER) {
            if chunk.is_empty() {
                continue;
            }

            let placeholders = vec!["?"; chunk.len()].join(", ");
            let sql = format!("SELECT id, {column} FROM sessions WHERE id IN ({placeholders})");
            let mut stmt = conn.prepare(&sql)?;
            let params: Vec<&dyn ToSql> = chunk.iter().map(|id| id as &dyn ToSql).collect();
            let rows = stmt.query_map(params.as_slice(), |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, Option<String>>(1)?))
            })?;

            for row in rows {
                let (id, value) = row?;
                values.insert(id, value);
            }
        }

        Ok(values)
    }
}

impl SessionMethods for Database {
    fn create_session(&self, session: &Session) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "INSERT INTO sessions (
                id, name, display_name, version_group_id, version_number,
                repository_path, repository_name,
                branch, parent_branch, worktree_path,
                status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                spec_content, session_state, resume_allowed
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            params![
                session.id,
                session.name,
                session.display_name,
                session.version_group_id,
                session.version_number,
                session.repository_path.to_string_lossy(),
                session.repository_name,
                session.branch,
                session.parent_branch,
                session.worktree_path.to_string_lossy(),
                session.status.as_str(),
                session.created_at.timestamp(),
                session.updated_at.timestamp(),
                session.last_activity.map(|dt| dt.timestamp()),
                session.initial_prompt,
                session.ready_to_merge,
                session.original_agent_type,
                session.original_skip_permissions,
                session.pending_name_generation,
                session.was_auto_generated,
                session.spec_content,
                session.session_state.as_str(),
                session.resume_allowed,
            ],
        )?;

        Ok(())
    }

    fn get_session_by_name(&self, repo_path: &Path, name: &str) -> Result<Session> {
        let conn = self.get_conn()?;

        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    spec_content, session_state, resume_allowed
             FROM sessions
             WHERE repository_path = ?1 AND name = ?2"
        )?;

        let session = stmt.query_row(params![repo_path.to_string_lossy(), name], |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                display_name: row.get(2).ok(),
                version_group_id: row.get(3).ok(),
                version_number: row.get(4).ok(),
                repository_path: PathBuf::from(row.get::<_, String>(5)?),
                repository_name: row.get(6)?,
                branch: row.get(7)?,
                parent_branch: row.get(8)?,
                worktree_path: PathBuf::from(row.get::<_, String>(9)?),
                status: row
                    .get::<_, String>(10)?
                    .parse()
                    .unwrap_or(SessionStatus::Active),
                created_at: Utc.timestamp_opt(row.get(11)?, 0).unwrap(),
                updated_at: Utc.timestamp_opt(row.get(12)?, 0).unwrap(),
                last_activity: row
                    .get::<_, Option<i64>>(13)?
                    .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                initial_prompt: row.get(14)?,
                ready_to_merge: row.get(15).unwrap_or(false),
                original_agent_type: row.get(16).ok(),
                original_skip_permissions: row.get(17).ok(),
                pending_name_generation: row.get(18).unwrap_or(false),
                was_auto_generated: row.get(19).unwrap_or(false),
                spec_content: row.get(20).ok(),
                session_state: row
                    .get::<_, String>(21)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(SessionState::Running),
                resume_allowed: row.get(22).unwrap_or(true),
            })
        })?;

        Ok(session)
    }

    fn get_session_by_id(&self, id: &str) -> Result<Session> {
        let conn = self.get_conn()?;

        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    spec_content, session_state, resume_allowed
             FROM sessions
             WHERE id = ?1"
        )?;

        let session = stmt.query_row(params![id], |row| {
            Ok(Session {
                id: row.get(0)?,
                name: row.get(1)?,
                display_name: row.get(2).ok(),
                version_group_id: row.get(3).ok(),
                version_number: row.get(4).ok(),
                repository_path: PathBuf::from(row.get::<_, String>(5)?),
                repository_name: row.get(6)?,
                branch: row.get(7)?,
                parent_branch: row.get(8)?,
                worktree_path: PathBuf::from(row.get::<_, String>(9)?),
                status: row
                    .get::<_, String>(10)?
                    .parse()
                    .unwrap_or(SessionStatus::Active),
                created_at: Utc.timestamp_opt(row.get(11)?, 0).unwrap(),
                updated_at: Utc.timestamp_opt(row.get(12)?, 0).unwrap(),
                last_activity: row
                    .get::<_, Option<i64>>(13)?
                    .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                initial_prompt: row.get(14)?,
                ready_to_merge: row.get(15).unwrap_or(false),
                original_agent_type: row.get(16).ok(),
                original_skip_permissions: row.get(17).ok(),
                pending_name_generation: row.get(18).unwrap_or(false),
                was_auto_generated: row.get(19).unwrap_or(false),
                spec_content: row.get(20).ok(),
                session_state: row
                    .get::<_, String>(21)
                    .ok()
                    .and_then(|s| s.parse().ok())
                    .unwrap_or(SessionState::Running),
                resume_allowed: row.get(22).unwrap_or(true),
            })
        })?;

        Ok(session)
    }

    fn get_session_task_content(
        &self,
        repo_path: &Path,
        name: &str,
    ) -> Result<(Option<String>, Option<String>, SessionState)> {
        let conn = self.get_conn()?;

        let mut stmt = conn.prepare(
            "SELECT spec_content, initial_prompt, session_state
             FROM sessions
             WHERE repository_path = ?1 AND name = ?2",
        )?;

        let result = stmt.query_row(params![repo_path.to_string_lossy(), name], |row| {
            let spec_content: Option<String> = row.get(0)?;
            let initial_prompt: Option<String> = row.get(1)?;
            let session_state_str: String = row.get(2)?;
            let session_state = SessionState::from_str(&session_state_str)
                .map_err(|_e| rusqlite::Error::InvalidQuery)?;
            Ok((spec_content, initial_prompt, session_state))
        })?;

        Ok(result)
    }

    fn list_sessions(&self, repo_path: &Path) -> Result<Vec<Session>> {
        let summary_timer = Instant::now();
        let conn = self.get_conn()?;
        let summaries = {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                        branch, parent_branch, worktree_path,
                        status, created_at, updated_at, last_activity, ready_to_merge,
                        original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                        session_state, resume_allowed
                 FROM sessions
                 WHERE repository_path = ?1
                 ORDER BY ready_to_merge ASC, last_activity DESC",
            )?;

            let rows = stmt.query_map(params![repo_path.to_string_lossy()], |row| {
                Ok(SessionSummaryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2).ok(),
                    version_group_id: row.get(3).ok(),
                    version_number: row.get(4).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(5)?),
                    repository_name: row.get(6)?,
                    branch: row.get(7)?,
                    parent_branch: row.get(8)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(9)?),
                    status: row
                        .get::<_, String>(10)?
                        .parse()
                        .unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(11)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(12)?, 0).unwrap(),
                    last_activity: row
                        .get::<_, Option<i64>>(13)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    ready_to_merge: row.get(14).unwrap_or(false),
                    original_agent_type: row.get(15).ok(),
                    original_skip_permissions: row.get(16).ok(),
                    pending_name_generation: row.get(17).unwrap_or(false),
                    was_auto_generated: row.get(18).unwrap_or(false),
                    session_state: row
                        .get::<_, String>(19)
                        .ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                    resume_allowed: row.get(20).unwrap_or(true),
                })
            })?;
            rows.collect::<SqlResult<Vec<_>>>()?
        };

        let summary_elapsed = summary_timer.elapsed();
        let hydrate_timer = Instant::now();
        let sessions = self.hydrate_session_summaries(&conn, summaries)?;
        let hydrate_elapsed = hydrate_timer.elapsed();

        log::debug!(
            "list_sessions: {} rows (summary={}ms, hydrate={}ms)",
            sessions.len(),
            summary_elapsed.as_millis(),
            hydrate_elapsed.as_millis()
        );

        Ok(sessions)
    }

    fn list_all_active_sessions(&self) -> Result<Vec<Session>> {
        let summary_timer = Instant::now();
        let conn = self.get_conn()?;
        let summaries = {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                        branch, parent_branch, worktree_path,
                        status, created_at, updated_at, last_activity, ready_to_merge,
                        original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                        session_state, resume_allowed
                 FROM sessions
                 WHERE status = 'active'
                 ORDER BY ready_to_merge ASC, last_activity DESC",
            )?;

            let rows = stmt.query_map([], |row| {
                Ok(SessionSummaryRow {
                    id: row.get(0)?,
                    name: row.get(1)?,
                    display_name: row.get(2).ok(),
                    version_group_id: row.get(3).ok(),
                    version_number: row.get(4).ok(),
                    repository_path: PathBuf::from(row.get::<_, String>(5)?),
                    repository_name: row.get(6)?,
                    branch: row.get(7)?,
                    parent_branch: row.get(8)?,
                    worktree_path: PathBuf::from(row.get::<_, String>(9)?),
                    status: row
                        .get::<_, String>(10)?
                        .parse()
                        .unwrap_or(SessionStatus::Active),
                    created_at: Utc.timestamp_opt(row.get(11)?, 0).unwrap(),
                    updated_at: Utc.timestamp_opt(row.get(12)?, 0).unwrap(),
                    last_activity: row
                        .get::<_, Option<i64>>(13)?
                        .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                    ready_to_merge: row.get(14).unwrap_or(false),
                    original_agent_type: row.get(15).ok(),
                    original_skip_permissions: row.get(16).ok(),
                    pending_name_generation: row.get(17).unwrap_or(false),
                    was_auto_generated: row.get(18).unwrap_or(false),
                    session_state: row
                        .get::<_, String>(19)
                        .ok()
                        .and_then(|s| s.parse().ok())
                        .unwrap_or(SessionState::Running),
                    resume_allowed: row.get(20).unwrap_or(true),
                })
            })?;
            rows.collect::<SqlResult<Vec<_>>>()?
        };

        let summary_elapsed = summary_timer.elapsed();
        let hydrate_timer = Instant::now();
        let sessions = self.hydrate_session_summaries(&conn, summaries)?;
        let hydrate_elapsed = hydrate_timer.elapsed();

        log::debug!(
            "list_all_active_sessions: {} rows (summary={}ms, hydrate={}ms)",
            sessions.len(),
            summary_elapsed.as_millis(),
            hydrate_elapsed.as_millis()
        );

        Ok(sessions)
    }

    fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET status = ?1, updated_at = ?2
             WHERE id = ?3",
            params![status.as_str(), Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn set_session_activity(
        &self,
        id: &str,
        timestamp: chrono::DateTime<chrono::Utc>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET last_activity = ?1 WHERE id = ?2",
            params![timestamp.timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET display_name = ?1, pending_name_generation = FALSE, updated_at = ?2 WHERE id = ?3",
            params![display_name, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_branch(&self, id: &str, new_branch: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_branch, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_parent_branch(&self, id: &str, new_parent_branch: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET parent_branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_parent_branch, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_pending_name_generation(&self, id: &str, pending: bool) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET pending_name_generation = ?1 WHERE id = ?2",
            params![pending, id],
        )?;
        Ok(())
    }

    fn update_session_ready_to_merge(&self, id: &str, ready: bool) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET ready_to_merge = ?1, updated_at = ?2
             WHERE id = ?3",
            params![ready, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn list_sessions_by_state(
        &self,
        repo_path: &Path,
        state: SessionState,
    ) -> Result<Vec<Session>> {
        let summary_timer = Instant::now();
        let conn = self.get_conn()?;
        let summaries = {
            let mut stmt = conn.prepare(
                "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                        branch, parent_branch, worktree_path,
                        status, created_at, updated_at, last_activity, ready_to_merge,
                        original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                        session_state, resume_allowed
                 FROM sessions
                 WHERE repository_path = ?1 AND session_state = ?2
                 ORDER BY ready_to_merge ASC, last_activity DESC",
            )?;

            let rows = stmt.query_map(
                params![repo_path.to_string_lossy(), state.as_str()],
                |row| {
                    Ok(SessionSummaryRow {
                        id: row.get(0)?,
                        name: row.get(1)?,
                        display_name: row.get(2).ok(),
                        version_group_id: row.get(3).ok(),
                        version_number: row.get(4).ok(),
                        repository_path: PathBuf::from(row.get::<_, String>(5)?),
                        repository_name: row.get(6)?,
                        branch: row.get(7)?,
                        parent_branch: row.get(8)?,
                        worktree_path: PathBuf::from(row.get::<_, String>(9)?),
                        status: row
                            .get::<_, String>(10)?
                            .parse()
                            .unwrap_or(SessionStatus::Active),
                        created_at: Utc.timestamp_opt(row.get(11)?, 0).unwrap(),
                        updated_at: Utc.timestamp_opt(row.get(12)?, 0).unwrap(),
                        last_activity: row
                            .get::<_, Option<i64>>(13)?
                            .and_then(|ts| Utc.timestamp_opt(ts, 0).single()),
                        ready_to_merge: row.get(14).unwrap_or(false),
                        original_agent_type: row.get(15).ok(),
                        original_skip_permissions: row.get(16).ok(),
                        pending_name_generation: row.get(17).unwrap_or(false),
                        was_auto_generated: row.get(18).unwrap_or(false),
                        session_state: row
                            .get::<_, String>(19)
                            .ok()
                            .and_then(|s| s.parse().ok())
                            .unwrap_or(SessionState::Running),
                        resume_allowed: row.get(20).unwrap_or(true),
                    })
                },
            )?;
            rows.collect::<SqlResult<Vec<_>>>()?
        };

        let summary_elapsed = summary_timer.elapsed();
        let hydrate_timer = Instant::now();
        let sessions = self.hydrate_session_summaries(&conn, summaries)?;
        let hydrate_elapsed = hydrate_timer.elapsed();

        log::debug!(
            "list_sessions_by_state({}): {} rows (summary={}ms, hydrate={}ms)",
            state.as_str(),
            sessions.len(),
            summary_elapsed.as_millis(),
            hydrate_elapsed.as_millis()
        );

        Ok(sessions)
    }

    fn update_session_state(&self, id: &str, state: SessionState) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET session_state = ?1, updated_at = ?2
             WHERE id = ?3",
            params![state.as_str(), Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn update_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET spec_content = ?1, updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn append_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET spec_content = CASE 
                 WHEN spec_content IS NULL OR spec_content = '' THEN ?1
                 ELSE spec_content || char(10) || ?1
             END,
             updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn update_session_initial_prompt(&self, id: &str, prompt: &str) -> Result<()> {
        let conn = self.get_conn()?;

        conn.execute(
            "UPDATE sessions
             SET initial_prompt = ?1, updated_at = ?2
             WHERE id = ?3",
            params![prompt, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn set_session_original_settings(
        &self,
        session_id: &str,
        agent_type: &str,
        skip_permissions: bool,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET original_agent_type = ?1, original_skip_permissions = ?2 WHERE id = ?3",
            params![agent_type, skip_permissions, session_id],
        )?;
        Ok(())
    }

    fn set_session_version_info(
        &self,
        id: &str,
        group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET version_group_id = ?1, version_number = ?2, updated_at = ?3 WHERE id = ?4",
            params![group_id, version_number, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn clear_session_run_state(&self, session_id: &str) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET last_activity = NULL, original_agent_type = NULL, original_skip_permissions = NULL WHERE id = ?1",
            params![session_id],
        )?;
        // Also delete git stats since specs don't have worktrees
        conn.execute(
            "DELETE FROM git_stats WHERE session_id = ?1",
            params![session_id],
        )?;
        Ok(())
    }

    fn set_session_resume_allowed(&self, id: &str, allowed: bool) -> Result<()> {
        let conn = self.get_conn()?;
        conn.execute(
            "UPDATE sessions SET resume_allowed = ?1, updated_at = ?2 WHERE id = ?3",
            params![allowed, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn rename_draft_session(&self, repo_path: &Path, old_name: &str, new_name: &str) -> Result<()> {
        let conn = self.get_conn()?;

        // First check if the session exists and is a spec
        let session = self.get_session_by_name(repo_path, old_name)?;
        if session.session_state != SessionState::Spec {
            return Err(anyhow::anyhow!("Can only rename spec sessions"));
        }

        // Check if the new name is already taken
        if self.get_session_by_name(repo_path, new_name).is_ok() {
            return Err(anyhow::anyhow!(
                "Session with name '{new_name}' already exists"
            ));
        }

        // Calculate new worktree path based on new session name
        let new_worktree_path = repo_path
            .join(".schaltwerk")
            .join("worktrees")
            .join(new_name);

        // Update the session name and worktree path
        conn.execute(
            "UPDATE sessions 
             SET name = ?1, worktree_path = ?2, updated_at = ?3 
             WHERE repository_path = ?4 AND name = ?5",
            params![
                new_name,
                new_worktree_path.to_string_lossy(),
                Utc::now().timestamp(),
                repo_path.to_string_lossy(),
                old_name
            ],
        )?;

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use rusqlite::params;

    #[test]
    fn test_repo_order_index_structure_and_plan() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let conn = db.get_conn().expect("failed to borrow connection");

        let mut columns_stmt = conn
            .prepare("PRAGMA index_info('idx_sessions_repo_order')")
            .expect("failed to prepare PRAGMA index_info");
        let columns = columns_stmt
            .query_map([], |row| row.get::<_, String>(2))
            .expect("failed to query index info")
            .collect::<Result<Vec<_>, _>>()
            .expect("failed to collect index info");
        assert_eq!(
            columns,
            vec!["repository_path", "ready_to_merge", "last_activity"],
            "idx_sessions_repo_order should cover repository_path, ready_to_merge, last_activity"
        );

        let plan_sql = "EXPLAIN QUERY PLAN SELECT id FROM sessions WHERE repository_path = ?1 ORDER BY ready_to_merge ASC, last_activity DESC";
        let mut stmt = conn
            .prepare(plan_sql)
            .expect("failed to prepare EXPLAIN statement");
        let mut rows = stmt
            .query(params!["/tmp/repo"])
            .expect("failed to run EXPLAIN");

        while let Some(row) = rows.next().expect("failed to read EXPLAIN row") {
            let detail: String = row.get(3).expect("failed to read detail column");
            assert!(
                !detail.to_uppercase().contains("TEMP B-TREE"),
                "query plan unexpectedly uses a temp B-tree: {detail}"
            );
        }
    }

    #[test]
    fn test_status_order_index_structure_and_plan() {
        let db = Database::new_in_memory().expect("failed to build in-memory database");
        let conn = db.get_conn().expect("failed to borrow connection");

        let mut columns_stmt = conn
            .prepare("PRAGMA index_info('idx_sessions_status_order')")
            .expect("failed to prepare PRAGMA index_info");
        let columns = columns_stmt
            .query_map([], |row| row.get::<_, String>(2))
            .expect("failed to query index info")
            .collect::<Result<Vec<_>, _>>()
            .expect("failed to collect index info");
        assert_eq!(
            columns,
            vec!["status", "ready_to_merge", "last_activity"],
            "idx_sessions_status_order should cover status, ready_to_merge, last_activity"
        );

        let plan_sql = "EXPLAIN QUERY PLAN SELECT id FROM sessions WHERE status = ?1 ORDER BY ready_to_merge ASC, last_activity DESC";
        let mut stmt = conn
            .prepare(plan_sql)
            .expect("failed to prepare EXPLAIN statement");
        let mut rows = stmt
            .query(params!["active"])
            .expect("failed to run EXPLAIN");

        while let Some(row) = rows.next().expect("failed to read EXPLAIN row") {
            let detail: String = row.get(3).expect("failed to read detail column");
            assert!(
                !detail.to_uppercase().contains("TEMP B-TREE"),
                "query plan unexpectedly uses a temp B-tree: {detail}"
            );
        }
    }
}
