use crate::{
    domains::git::db_git_stats::GitStatsMethods,
    domains::git::service as git,
    domains::sessions::db_sessions::SessionMethods,
    domains::sessions::entity::{GitStats, Session, SessionState, SessionStatus, Spec},
    infrastructure::database::{AppConfigMethods, Database, ProjectConfigMethods, SpecMethods},
};
use anyhow::{Context, Result, anyhow};
use chrono::Utc;
use git2::Repository;
use log::{debug, warn};
use std::path::PathBuf;

#[derive(Clone)]
pub struct SessionDbManager {
    pub db: Database,
    pub repo_path: PathBuf,
}

impl SessionDbManager {
    pub fn new(db: Database, repo_path: PathBuf) -> Self {
        Self { db, repo_path }
    }

    fn normalize_spec_state(&self, session: &mut Session) -> Result<()> {
        if session.status == SessionStatus::Spec && session.session_state != SessionState::Spec {
            warn!(
                "Correcting inconsistent session_state for spec session '{}': {:?} -> Spec",
                session.name, session.session_state
            );
            self.db
                .update_session_state(&session.id, SessionState::Spec)?;
            session.session_state = SessionState::Spec;
        }

        Ok(())
    }

    fn try_open_repo(&self) -> Option<Repository> {
        match Repository::open(&self.repo_path) {
            Ok(repo) => Some(repo),
            Err(err) => {
                debug!(
                    "Skipping parent branch normalization: failed to open repo '{}': {err}",
                    self.repo_path.display()
                );
                None
            }
        }
    }

    fn normalize_parent_branch_with_repo(&self, repo: Option<&Repository>, session: &mut Session) {
        let trimmed = session.parent_branch.trim();
        if trimmed.is_empty() {
            return;
        }

        let Some(repo) = repo else {
            return;
        };

        match git::normalize_branch_to_local(repo, trimmed) {
            Ok(local_branch) => {
                if local_branch == session.parent_branch {
                    return;
                }

                debug!(
                    "Normalized parent branch for session '{}' from '{}' to '{}'",
                    session.name, session.parent_branch, local_branch
                );

                if let Err(err) = self
                    .db
                    .update_session_parent_branch(&session.id, &local_branch)
                {
                    warn!(
                        "Failed to persist normalized parent branch '{}' for session '{}': {}",
                        local_branch, session.name, err
                    );
                }

                session.parent_branch = local_branch;
            }
            Err(err) => {
                if repo.revparse_single(trimmed).is_ok() {
                    debug!(
                        "Parent branch '{}' for session '{}' resolves via revspec; leaving as-is",
                        trimmed, session.name
                    );
                    return;
                }

                warn!(
                    "Unable to normalize parent branch '{}' for session '{}': {}",
                    trimmed, session.name, err
                );
            }
        }
    }

    pub fn create_session(&self, session: &Session) -> Result<()> {
        self.db
            .create_session(session)
            .map_err(|e| anyhow!("Failed to create session in database: {e}"))
    }

    pub fn get_session_by_name(&self, name: &str) -> Result<Session> {
        let mut session = self
            .db
            .get_session_by_name(&self.repo_path, name)
            .map_err(|e| anyhow!("Failed to get session '{name}': {e}"))?;

        self.normalize_spec_state(&mut session)?;
        let repo = self.try_open_repo();
        self.normalize_parent_branch_with_repo(repo.as_ref(), &mut session);
        Ok(session)
    }

    pub fn get_session_by_id(&self, id: &str) -> Result<Session> {
        let mut session = self
            .db
            .get_session_by_id(id)
            .map_err(|e| anyhow!("Failed to get session with id '{id}': {e}"))?;

        self.normalize_spec_state(&mut session)?;
        let repo = self.try_open_repo();
        self.normalize_parent_branch_with_repo(repo.as_ref(), &mut session);
        Ok(session)
    }

    pub fn list_sessions(&self) -> Result<Vec<Session>> {
        let mut sessions = self.db.list_sessions(&self.repo_path)?;
        let repo = self.try_open_repo();
        let repo_ref = repo.as_ref();
        for session in sessions.iter_mut() {
            self.normalize_spec_state(session)?;
            self.normalize_parent_branch_with_repo(repo_ref, session);
        }

        Ok(sessions
            .into_iter()
            .filter(|session| session.status != SessionStatus::Cancelled)
            .collect())
    }

    pub fn list_sessions_by_state(&self, state: SessionState) -> Result<Vec<Session>> {
        let mut sessions = self
            .db
            .list_sessions_by_state(&self.repo_path, state.clone())?;
        let repo = self.try_open_repo();
        let repo_ref = repo.as_ref();
        for session in sessions.iter_mut() {
            self.normalize_spec_state(session)?;
            self.normalize_parent_branch_with_repo(repo_ref, session);
        }

        Ok(sessions
            .into_iter()
            .filter(|session| {
                session.status != SessionStatus::Cancelled && session.session_state == state
            })
            .collect())
    }

    pub fn list_specs(&self) -> Result<Vec<Spec>> {
        self.db
            .list_specs(&self.repo_path)
            .map_err(|e| anyhow!("Failed to list specs: {e}"))
    }

    pub fn get_spec_by_name(&self, name: &str) -> Result<Spec> {
        self.db
            .get_spec_by_name(&self.repo_path, name)
            .map_err(|e| anyhow!("Failed to get spec '{name}': {e}"))
    }

    pub fn create_spec(&self, spec: &Spec) -> Result<()> {
        self.db
            .create_spec(spec)
            .map_err(|e| anyhow!("Failed to create spec '{}': {e}", spec.name))
    }

    pub fn update_spec_content_by_id(&self, id: &str, content: &str) -> Result<()> {
        SpecMethods::update_spec_content(&self.db, id, content)
            .map_err(|e| anyhow!("Failed to update spec content: {e}"))
    }

    pub fn update_spec_display_name(&self, id: &str, display_name: &str) -> Result<()> {
        SpecMethods::update_spec_display_name(&self.db, id, display_name)
            .map_err(|e| anyhow!("Failed to update spec display name: {e}"))
    }

    pub fn delete_spec(&self, id: &str) -> Result<()> {
        self.db
            .delete_spec(id)
            .map_err(|e| anyhow!("Failed to delete spec: {e}"))
    }

    pub fn update_session_status(&self, session_id: &str, status: SessionStatus) -> Result<()> {
        self.db
            .update_session_status(session_id, status)
            .map_err(|e| anyhow!("Failed to update session status: {e}"))
    }

    pub fn update_session_state(&self, session_id: &str, state: SessionState) -> Result<()> {
        self.db
            .update_session_state(session_id, state)
            .map_err(|e| anyhow!("Failed to update session state: {e}"))?;

        if let Ok(session) = self.db.get_session_by_id(session_id) {
            crate::domains::sessions::cache::invalidate_spec_content(
                &self.repo_path,
                &session.name,
            );
        }

        Ok(())
    }

    pub fn update_session_ready_to_merge(&self, session_id: &str, ready: bool) -> Result<()> {
        self.db
            .update_session_ready_to_merge(session_id, ready)
            .map_err(|e| anyhow!("Failed to update session ready_to_merge: {e}"))
    }

    pub fn update_session_initial_prompt(&self, session_id: &str, prompt: &str) -> Result<()> {
        self.db
            .update_session_initial_prompt(session_id, prompt)
            .map_err(|e| anyhow!("Failed to update session initial prompt: {e}"))
    }

    pub fn update_spec_content(&self, session_id: &str, content: &str) -> Result<()> {
        let spec = self
            .db
            .get_spec_by_id(session_id)
            .context("Spec not found while updating content")?;

        self.update_spec_content_by_id(&spec.id, content)?;
        crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, &spec.name);
        Ok(())
    }

    pub fn append_spec_content(&self, session_id: &str, content: &str) -> Result<()> {
        // Specs: replace with append semantics on specs table
        if let Ok(spec) = self.db.get_spec_by_id(session_id) {
            let combined = if spec.content.is_empty() {
                content.to_string()
            } else {
                format!("{}\n{}", spec.content, content)
            };
            self.update_spec_content_by_id(&spec.id, &combined)?;
            crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, &spec.name);
            return Ok(());
        }

        self.db
            .append_spec_content(session_id, content)
            .map_err(|e| anyhow!("Failed to append spec content: {e}"))?;

        if let Ok(session) = self.db.get_session_by_id(session_id) {
            crate::domains::sessions::cache::invalidate_spec_content(
                &self.repo_path,
                &session.name,
            );
        }

        Ok(())
    }

    pub fn get_session_task_content(&self, name: &str) -> Result<(Option<String>, Option<String>)> {
        if let Some(cached) =
            crate::domains::sessions::cache::get_cached_spec_content(&self.repo_path, name)
        {
            log::debug!("Cache hit for spec content: {name}");
            return Ok(cached);
        }

        let (spec_content, initial_prompt, session_state) = match self
            .db
            .get_session_task_content(&self.repo_path, name)
        {
            Ok(result) => result,
            Err(error) => {
                if error
                    .downcast_ref::<rusqlite::Error>()
                    .is_some_and(|sql_error| {
                        matches!(sql_error, rusqlite::Error::QueryReturnedNoRows)
                    })
                {
                    // Try the specs table as a fallback
                    if let Ok(spec) = self.db.get_spec_by_name(&self.repo_path, name) {
                        let result = (Some(spec.content.clone()), None, SessionState::Spec);
                        crate::domains::sessions::cache::cache_spec_content(
                            &self.repo_path,
                            name,
                            (Some(spec.content), None),
                        );
                        return Ok((result.0.clone(), result.1.clone()));
                    }

                    warn!(
                        "Spec content requested for missing session '{name}', returning empty payload"
                    );
                    crate::domains::sessions::cache::invalidate_spec_content(&self.repo_path, name);
                    return Ok((None, None));
                }

                return Err(anyhow!("Failed to get session agent content: {error}"));
            }
        };

        let result = (spec_content, initial_prompt);

        if matches!(
            session_state,
            crate::domains::sessions::entity::SessionState::Running
                | crate::domains::sessions::entity::SessionState::Reviewed
        ) {
            log::debug!("Caching spec content for running/reviewed session: {name}");
            crate::domains::sessions::cache::cache_spec_content(
                &self.repo_path,
                name,
                result.clone(),
            );
        }

        Ok(result)
    }

    pub fn set_session_original_settings(
        &self,
        session_id: &str,
        agent_type: &str,
        skip_permissions: bool,
    ) -> Result<()> {
        self.db
            .set_session_original_settings(session_id, agent_type, skip_permissions)
            .map_err(|e| anyhow!("Failed to set session original settings: {e}"))
    }

    pub fn set_session_activity(
        &self,
        session_id: &str,
        activity_time: chrono::DateTime<Utc>,
    ) -> Result<()> {
        self.db
            .set_session_activity(session_id, activity_time)
            .map_err(|e| anyhow!("Failed to set session activity: {e}"))
    }

    pub fn set_session_version_info(
        &self,
        session_id: &str,
        group_id: Option<&str>,
        version_number: Option<i32>,
    ) -> Result<()> {
        self.db
            .set_session_version_info(session_id, group_id, version_number)
            .map_err(|e| anyhow!("Failed to set session version info: {e}"))
    }

    pub fn clear_session_run_state(&self, session_id: &str) -> Result<()> {
        self.db
            .clear_session_run_state(session_id)
            .map_err(|e| anyhow!("Failed to clear session run state: {e}"))
    }

    pub fn set_session_resume_allowed(&self, session_id: &str, allowed: bool) -> Result<()> {
        self.db
            .set_session_resume_allowed(session_id, allowed)
            .map_err(|e| anyhow!("Failed to set resume_allowed: {e}"))
    }

    pub fn set_session_amp_thread_id(&self, session_id: &str, thread_id: &str) -> Result<()> {
        self.db
            .set_session_amp_thread_id(session_id, thread_id)
            .map_err(|e| anyhow!("Failed to set amp_thread_id: {e}"))
    }

    pub fn rename_draft_session(&self, old_name: &str, new_name: &str) -> Result<()> {
        self.db
            .rename_draft_session(&self.repo_path, old_name, new_name)
            .map_err(|e| anyhow!("Failed to rename spec session: {e}"))
    }

    pub fn delete_session(&self, session_id: &str) -> Result<()> {
        self.db
            .delete_session(session_id)
            .map_err(|e| anyhow!("Failed to delete session '{session_id}': {e}"))
    }

    pub fn save_git_stats(&self, stats: &GitStats) -> Result<()> {
        self.db
            .save_git_stats(stats)
            .map_err(|e| anyhow!("Failed to save git stats: {e}"))
    }

    pub fn get_git_stats(&self, session_id: &str) -> Result<Option<GitStats>> {
        self.db
            .get_git_stats(session_id)
            .map_err(|e| anyhow!("Failed to get git stats: {e}"))
    }

    pub fn get_all_git_stats(&self) -> Result<Vec<GitStats>> {
        self.db
            .get_all_git_stats()
            .map_err(|e| anyhow!("Failed to get all git stats: {e}"))
    }

    pub fn get_git_stats_bulk(&self, session_ids: &[String]) -> Result<Vec<GitStats>> {
        self.db
            .get_git_stats_bulk(session_ids)
            .map_err(|e| anyhow!("Failed to get bulk git stats: {e}"))
    }

    pub fn update_git_stats(&self, session_id: &str) -> Result<()> {
        let session = self.get_session_by_id(session_id)?;
        let mut stats =
            git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch)?;
        stats.session_id = session_id.to_string();
        self.save_git_stats(&stats)?;
        Ok(())
    }

    pub fn get_project_setup_script(&self) -> Result<Option<String>> {
        self.db
            .get_project_setup_script(&self.repo_path)
            .map_err(|e| anyhow!("Failed to get project setup script: {e}"))
    }

    pub fn get_agent_type(&self) -> Result<String> {
        self.db
            .get_agent_type()
            .map_err(|e| anyhow!("Failed to get agent type: {e}"))
    }

    pub fn get_skip_permissions(&self) -> Result<bool> {
        self.db
            .get_skip_permissions()
            .map_err(|e| anyhow!("Failed to get skip permissions: {e}"))
    }

    pub fn get_orchestrator_agent_type(&self) -> Result<String> {
        self.db
            .get_orchestrator_agent_type()
            .map_err(|e| anyhow!("Failed to get orchestrator agent type: {e}"))
    }

    pub fn get_orchestrator_skip_permissions(&self) -> Result<bool> {
        self.db
            .get_orchestrator_skip_permissions()
            .map_err(|e| anyhow!("Failed to get orchestrator skip permissions: {e}"))
    }

    pub fn set_skip_permissions(&self, skip: bool) -> Result<()> {
        self.db
            .set_skip_permissions(skip)
            .map_err(|e| anyhow!("Failed to set skip permissions: {e}"))
    }

    pub fn set_agent_type(&self, agent_type: &str) -> Result<()> {
        self.db
            .set_agent_type(agent_type)
            .map_err(|e| anyhow!("Failed to set agent type: {e}"))
    }

    pub fn set_orchestrator_skip_permissions(&self, skip: bool) -> Result<()> {
        self.db
            .set_orchestrator_skip_permissions(skip)
            .map_err(|e| anyhow!("Failed to set orchestrator skip permissions: {e}"))
    }

    pub fn set_orchestrator_agent_type(&self, agent_type: &str) -> Result<()> {
        self.db
            .set_orchestrator_agent_type(agent_type)
            .map_err(|e| anyhow!("Failed to set orchestrator agent type: {e}"))
    }

    pub fn get_enriched_git_stats(&self, session: &Session) -> Result<Option<GitStats>> {
        match self.get_git_stats(&session.id)? {
            Some(existing) => {
                let is_stale = Utc::now().timestamp() - existing.calculated_at.timestamp() > 60;
                if is_stale {
                    let mut updated = git::calculate_git_stats_fast(
                        &session.worktree_path,
                        &session.parent_branch,
                    )
                    .ok();
                    if let Some(ref mut s) = updated {
                        s.session_id = session.id.clone();
                        let _ = self.save_git_stats(s);
                    }
                    Ok(updated.or(Some(existing)))
                } else {
                    Ok(Some(existing))
                }
            }
            None => {
                let mut computed =
                    git::calculate_git_stats_fast(&session.worktree_path, &session.parent_branch)
                        .ok();
                if let Some(ref mut s) = computed {
                    s.session_id = session.id.clone();
                    let _ = self.save_git_stats(s);
                }
                Ok(computed)
            }
        }
    }

    pub fn session_exists(&self, name: &str) -> bool {
        if self.get_session_by_name(name).is_ok() {
            return true;
        }

        self.get_spec_by_name(name).is_ok()
    }
}

#[cfg(test)]
impl SessionDbManager {
    pub fn db_ref(&self) -> &Database {
        &self.db
    }
}
