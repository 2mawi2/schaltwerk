use crate::domains::sessions::entity::{Session, SessionState, SessionStatus};
use crate::schaltwerk_core::database::Database;
use anyhow::Result;
use chrono::{TimeZone, Utc};
use rusqlite::{params, Result as SqlResult};
use std::path::{Path, PathBuf};
use std::str::FromStr;

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

impl SessionMethods for Database {
    fn create_session(&self, session: &Session) -> Result<()> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    spec_content, session_state, resume_allowed
             FROM sessions
             WHERE repository_path = ?1
             ORDER BY ready_to_merge ASC, last_activity DESC"
        )?;

        let sessions = stmt
            .query_map(params![repo_path.to_string_lossy()], |row| {
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
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(sessions)
    }

    fn list_all_active_sessions(&self) -> Result<Vec<Session>> {
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    spec_content, session_state, resume_allowed
             FROM sessions
             WHERE status = 'active'
             ORDER BY ready_to_merge ASC, last_activity DESC"
        )?;

        let sessions = stmt
            .query_map([], |row| {
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
            })?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(sessions)
    }

    fn update_session_status(&self, id: &str, status: SessionStatus) -> Result<()> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET last_activity = ?1 WHERE id = ?2",
            params![timestamp.timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET display_name = ?1, pending_name_generation = FALSE, updated_at = ?2 WHERE id = ?3",
            params![display_name, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_branch(&self, id: &str, new_branch: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_branch, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn update_session_parent_branch(&self, id: &str, new_parent_branch: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET parent_branch = ?1, updated_at = ?2 WHERE id = ?3",
            params![new_parent_branch, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn set_pending_name_generation(&self, id: &str, pending: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET pending_name_generation = ?1 WHERE id = ?2",
            params![pending, id],
        )?;
        Ok(())
    }

    fn update_session_ready_to_merge(&self, id: &str, ready: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();

        let mut stmt = conn.prepare(
            "SELECT id, name, display_name, version_group_id, version_number, repository_path, repository_name,
                    branch, parent_branch, worktree_path,
                    status, created_at, updated_at, last_activity, initial_prompt, ready_to_merge,
                    original_agent_type, original_skip_permissions, pending_name_generation, was_auto_generated,
                    spec_content, session_state, resume_allowed
             FROM sessions
             WHERE repository_path = ?1 AND session_state = ?2
             ORDER BY ready_to_merge ASC, last_activity DESC"
        )?;

        let sessions = stmt
            .query_map(
                params![repo_path.to_string_lossy(), state.as_str()],
                |row| {
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
                },
            )?
            .collect::<SqlResult<Vec<_>>>()?;

        Ok(sessions)
    }

    fn update_session_state(&self, id: &str, state: SessionState) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "UPDATE sessions
             SET session_state = ?1, updated_at = ?2
             WHERE id = ?3",
            params![state.as_str(), Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn update_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();

        conn.execute(
            "UPDATE sessions
             SET spec_content = ?1, updated_at = ?2
             WHERE id = ?3",
            params![content, Utc::now().timestamp(), id],
        )?;

        Ok(())
    }

    fn append_spec_content(&self, id: &str, content: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET version_group_id = ?1, version_number = ?2, updated_at = ?3 WHERE id = ?4",
            params![group_id, version_number, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn clear_session_run_state(&self, session_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
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
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE sessions SET resume_allowed = ?1, updated_at = ?2 WHERE id = ?3",
            params![allowed, Utc::now().timestamp(), id],
        )?;
        Ok(())
    }

    fn rename_draft_session(&self, repo_path: &Path, old_name: &str, new_name: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();

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
