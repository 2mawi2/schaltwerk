use super::connection::Database;
use anyhow::{Result, anyhow};
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const DEFAULT_BRANCH_PREFIX: &str = "";

fn normalize_branch_prefix(input: &str) -> String {
    let trimmed = input.trim();
    let trimmed = trimmed.trim_matches('/');
    trimmed.trim().to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSessionsSettings {
    pub filter_mode: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectMergePreferences {
    pub auto_cancel_after_merge: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct HeaderActionConfig {
    pub id: String,
    pub label: String,
    pub prompt: String, // Changed from command to prompt
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct RunScript {
    pub command: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub working_directory: Option<String>,
    #[serde(default)]
    pub environment_variables: HashMap<String, String>,
    #[serde(default, alias = "preview_localhost_on_click")]
    pub preview_localhost_on_click: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ProjectGithubConfig {
    pub repository: String,
    pub default_branch: String,
}

pub trait ProjectConfigMethods {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>>;
    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()>;
    fn clear_project_setup_script(&self, repo_path: &Path) -> Result<()>;
    fn get_project_sessions_settings(&self, repo_path: &Path) -> Result<ProjectSessionsSettings>;
    fn set_project_sessions_settings(
        &self,
        repo_path: &Path,
        settings: &ProjectSessionsSettings,
    ) -> Result<()>;
    fn get_project_branch_prefix(&self, repo_path: &Path) -> Result<String>;
    fn set_project_branch_prefix(&self, repo_path: &Path, branch_prefix: &str) -> Result<()>;
    fn get_project_environment_variables(
        &self,
        repo_path: &Path,
    ) -> Result<HashMap<String, String>>;
    fn set_project_environment_variables(
        &self,
        repo_path: &Path,
        env_vars: &HashMap<String, String>,
    ) -> Result<()>;
    fn get_project_merge_preferences(&self, repo_path: &Path) -> Result<ProjectMergePreferences>;
    fn set_project_merge_preferences(
        &self,
        repo_path: &Path,
        preferences: &ProjectMergePreferences,
    ) -> Result<()>;
    fn get_project_action_buttons(&self, repo_path: &Path) -> Result<Vec<HeaderActionConfig>>;
    fn set_project_action_buttons(
        &self,
        repo_path: &Path,
        actions: &[HeaderActionConfig],
    ) -> Result<()>;
    fn get_project_run_script(&self, repo_path: &Path) -> Result<Option<RunScript>>;
    fn set_project_run_script(&self, repo_path: &Path, run_script: &RunScript) -> Result<()>;
    fn get_project_github_config(&self, repo_path: &Path) -> Result<Option<ProjectGithubConfig>>;
    fn set_project_github_config(
        &self,
        repo_path: &Path,
        config: &ProjectGithubConfig,
    ) -> Result<()>;
    fn clear_project_github_config(&self, repo_path: &Path) -> Result<()>;
}

impl ProjectConfigMethods for Database {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>> {
        let conn = self.get_conn()?;

        // Canonicalize the path for consistent storage/retrieval
        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let result: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT setup_script FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        match result {
            Ok(Some(script)) => Ok(Some(script)),
            Ok(None) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        // Canonicalize the path for consistent storage/retrieval
        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    setup_script,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    ?2,
                    ?3,
                    ?4
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    setup_script = excluded.setup_script,
                    updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), setup_script, now, now],
        )?;

        Ok(())
    }

    fn clear_project_setup_script(&self, repo_path: &Path) -> Result<()> {
        let conn = self.get_conn()?;
        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
            "UPDATE project_config SET setup_script = NULL WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
        )?;

        Ok(())
    }

    fn get_project_sessions_settings(&self, repo_path: &Path) -> Result<ProjectSessionsSettings> {
        let conn = self.get_conn()?;

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT sessions_filter_mode
                FROM project_config
                WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        match query_res {
            Ok(filter_opt) => Ok(ProjectSessionsSettings {
                filter_mode: filter_opt.unwrap_or_else(|| "all".to_string()),
            }),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(ProjectSessionsSettings {
                filter_mode: "all".to_string(),
            }),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_sessions_settings(
        &self,
        repo_path: &Path,
        settings: &ProjectSessionsSettings,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    sessions_filter_mode,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    ?2,
                    ?3,
                    ?4
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    sessions_filter_mode = excluded.sessions_filter_mode,
                    updated_at           = excluded.updated_at",
            params![
                canonical_path.to_string_lossy(),
                settings.filter_mode,
                now,
                now,
            ],
        )?;

        Ok(())
    }

    fn get_project_branch_prefix(&self, repo_path: &Path) -> Result<String> {
        let conn = self.get_conn()?;

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let result: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT branch_prefix FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        match result {
            Ok(Some(value)) => Ok(normalize_branch_prefix(&value)),
            Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => {
                Ok(DEFAULT_BRANCH_PREFIX.to_string())
            }
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_branch_prefix(&self, repo_path: &Path, branch_prefix: &str) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let normalized = normalize_branch_prefix(branch_prefix);

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    branch_prefix,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    ?2,
                    ?3,
                    ?4
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    branch_prefix = excluded.branch_prefix,
                    updated_at    = excluded.updated_at",
            params![canonical_path.to_string_lossy(), normalized, now, now,],
        )?;

        Ok(())
    }

    fn get_project_environment_variables(
        &self,
        repo_path: &Path,
    ) -> Result<HashMap<String, String>> {
        let conn = self.get_conn()?;

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT environment_variables
                FROM project_config
                WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        match query_res {
            Ok(Some(json_str)) => {
                let env_vars: HashMap<String, String> = serde_json::from_str(&json_str)?;
                Ok(env_vars)
            }
            Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(HashMap::new()),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_environment_variables(
        &self,
        repo_path: &Path,
        env_vars: &HashMap<String, String>,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let json_str = serde_json::to_string(env_vars)?;

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    environment_variables,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    ?2,
                    ?3,
                    ?4
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    environment_variables = excluded.environment_variables,
                    updated_at            = excluded.updated_at",
            params![canonical_path.to_string_lossy(), json_str, now, now],
        )?;

        Ok(())
    }

    fn get_project_merge_preferences(&self, repo_path: &Path) -> Result<ProjectMergePreferences> {
        let conn = self.get_conn()?;

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<i64> = conn.query_row(
            "SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        let auto_cancel = match query_res {
            Ok(auto_cancel_raw) => auto_cancel_raw != 0,
            Err(rusqlite::Error::QueryReturnedNoRows) => true,
            Err(e) => match e {
                rusqlite::Error::SqliteFailure(_, _) => true,
                other => return Err(other.into()),
            },
        };

        Ok(ProjectMergePreferences {
            auto_cancel_after_merge: auto_cancel,
        })
    }

    fn set_project_merge_preferences(
        &self,
        repo_path: &Path,
        preferences: &ProjectMergePreferences,
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
        let value = if preferences.auto_cancel_after_merge {
            1
        } else {
            0
        };

        conn.execute(
            "INSERT INTO project_config (repository_path, auto_cancel_after_merge,
                                            created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(repository_path) DO UPDATE SET
                    auto_cancel_after_merge = excluded.auto_cancel_after_merge,
                    updated_at              = excluded.updated_at",
            params![canonical_path.to_string_lossy(), value, now, now],
        )?;

        Ok(())
    }

    fn get_project_action_buttons(&self, repo_path: &Path) -> Result<Vec<HeaderActionConfig>> {
        let conn = self.get_conn()?;

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT action_buttons FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        match query_res {
            Ok(Some(json_str)) => {
                let actions: Vec<HeaderActionConfig> = serde_json::from_str(&json_str)?;
                Ok(actions)
            }
            Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => {
                Ok(Self::get_default_action_buttons())
            }
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_action_buttons(
        &self,
        repo_path: &Path,
        actions: &[HeaderActionConfig],
    ) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let json_str = serde_json::to_string(actions)?;

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    action_buttons,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    ?2,
                    ?3,
                    ?4
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    action_buttons = excluded.action_buttons,
                    updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), json_str, now, now],
        )?;

        Ok(())
    }

    fn get_project_run_script(&self, repo_path: &Path) -> Result<Option<RunScript>> {
        let conn = self.get_conn()?;

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT run_script FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        match query_res {
            Ok(Some(json_str)) => {
                let run_script: RunScript = serde_json::from_str(&json_str)?;
                Ok(Some(run_script))
            }
            Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_run_script(&self, repo_path: &Path, run_script: &RunScript) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let json_str = serde_json::to_string(run_script)?;

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    run_script,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    ?2,
                    ?3,
                    ?4
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    run_script = excluded.run_script,
                    updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), json_str, now, now],
        )?;

        Ok(())
    }

    fn get_project_github_config(&self, repo_path: &Path) -> Result<Option<ProjectGithubConfig>> {
        let conn = self.get_conn()?;

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<(Option<String>, Option<String>)> = conn.query_row(
            "SELECT github_repository, github_default_branch
                FROM project_config
                WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        match query_res {
            Ok((Some(repository), default_branch_opt)) => {
                let default_branch = default_branch_opt.unwrap_or_else(|| "main".to_string());
                Ok(Some(ProjectGithubConfig {
                    repository,
                    default_branch,
                }))
            }
            Ok((None, _)) | Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_github_config(
        &self,
        repo_path: &Path,
        config: &ProjectGithubConfig,
    ) -> Result<()> {
        let repository = config.repository.trim();
        let default_branch = config.default_branch.trim();

        if repository.is_empty() {
            return Err(anyhow!("Repository value cannot be empty"));
        }
        if default_branch.is_empty() {
            return Err(anyhow!("Default branch value cannot be empty"));
        }

        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    github_repository,
                    github_default_branch,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    ?2,
                    ?3,
                    ?4,
                    ?4
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    github_repository = excluded.github_repository,
                    github_default_branch = excluded.github_default_branch,
                    updated_at = excluded.updated_at",
            params![
                canonical_path.to_string_lossy(),
                repository,
                default_branch,
                now,
            ],
        )?;

        Ok(())
    }

    fn clear_project_github_config(&self, repo_path: &Path) -> Result<()> {
        let conn = self.get_conn()?;
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
            "INSERT INTO project_config (
                    repository_path,
                    auto_cancel_after_merge,
                    github_repository,
                    github_default_branch,
                    created_at,
                    updated_at
                )
                VALUES (
                    ?1,
                    COALESCE(
                        (SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1),
                        1
                    ),
                    NULL,
                    NULL,
                    ?2,
                    ?2
                )
                ON CONFLICT(repository_path) DO UPDATE SET
                    github_repository = NULL,
                    github_default_branch = NULL,
                    updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), now],
        )?;

        Ok(())
    }
}

impl Database {
    fn get_default_action_buttons() -> Vec<HeaderActionConfig> {
        vec![]
    }
}

pub fn default_action_buttons() -> Vec<HeaderActionConfig> {
    Database::get_default_action_buttons()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::infrastructure::database::connection::Database;
    use tempfile::TempDir;

    fn create_temp_repo_path() -> (TempDir, std::path::PathBuf) {
        let temp_dir = TempDir::new().expect("temp dir");
        let project_path = temp_dir.path().join("repo");
        std::fs::create_dir_all(&project_path).expect("create project path");
        (temp_dir, project_path)
    }

    #[test]
    fn github_config_round_trip() {
        let db = Database::new_in_memory().expect("db");
        let (_tmp, repo_path) = create_temp_repo_path();

        let config = ProjectGithubConfig {
            repository: "owner/example".to_string(),
            default_branch: "main".to_string(),
        };

        db.set_project_github_config(&repo_path, &config)
            .expect("store config");

        let loaded = db
            .get_project_github_config(&repo_path)
            .expect("load config");

        assert_eq!(Some(config), loaded);
    }

    #[test]
    fn github_config_clear_resets_state() {
        let db = Database::new_in_memory().expect("db");
        let (_tmp, repo_path) = create_temp_repo_path();

        let config = ProjectGithubConfig {
            repository: "owner/example".to_string(),
            default_branch: "main".to_string(),
        };

        db.set_project_github_config(&repo_path, &config)
            .expect("store config");

        db.clear_project_github_config(&repo_path)
            .expect("clear config");

        let loaded = db
            .get_project_github_config(&repo_path)
            .expect("load config");

        assert!(loaded.is_none());
    }

    #[test]
    fn defaults_auto_cancel_true_for_new_project_rows() {
        let db = Database::new_in_memory().expect("db");
        let (_tmp, repo_path) = create_temp_repo_path();

        // Trigger an insert via another settings path to simulate real initialization order
        db.set_project_branch_prefix(&repo_path, "schaltwerk")
            .expect("store branch prefix");

        let preferences = db
            .get_project_merge_preferences(&repo_path)
            .expect("load merge preferences");

        assert!(
            preferences.auto_cancel_after_merge,
            "expected auto-cancel-after-merge to default to true for new projects"
        );
    }

    #[test]
    fn normalize_branch_prefix_allows_empty_string() {
        assert_eq!(normalize_branch_prefix(""), "");
    }

    #[test]
    fn normalize_branch_prefix_trims_whitespace() {
        assert_eq!(normalize_branch_prefix("  prefix  "), "prefix");
    }

    #[test]
    fn normalize_branch_prefix_removes_slashes() {
        assert_eq!(normalize_branch_prefix("/prefix/"), "prefix");
        assert_eq!(normalize_branch_prefix("///prefix///"), "prefix");
    }

    #[test]
    fn normalize_branch_prefix_preserves_internal_slashes() {
        assert_eq!(normalize_branch_prefix("team/feature"), "team/feature");
    }

    #[test]
    fn normalize_branch_prefix_handles_whitespace_only_as_empty() {
        assert_eq!(normalize_branch_prefix("   "), "");
    }

    #[test]
    fn branch_prefix_round_trip_with_empty_string() {
        let db = Database::new_in_memory().expect("db");
        let (_tmp, repo_path) = create_temp_repo_path();

        db.set_project_branch_prefix(&repo_path, "")
            .expect("store empty branch prefix");

        let loaded = db
            .get_project_branch_prefix(&repo_path)
            .expect("load branch prefix");

        assert_eq!(loaded, "");
    }

    #[test]
    fn branch_prefix_defaults_to_empty_when_not_set() {
        let db = Database::new_in_memory().expect("db");
        let (_tmp, repo_path) = create_temp_repo_path();

        let loaded = db
            .get_project_branch_prefix(&repo_path)
            .expect("load branch prefix");

        assert_eq!(loaded, DEFAULT_BRANCH_PREFIX);
        assert!(loaded.is_empty());
    }

    #[test]
    fn branch_prefix_round_trip_with_custom_value() {
        let db = Database::new_in_memory().expect("db");
        let (_tmp, repo_path) = create_temp_repo_path();

        db.set_project_branch_prefix(&repo_path, "custom-prefix")
            .expect("store custom branch prefix");

        let loaded = db
            .get_project_branch_prefix(&repo_path)
            .expect("load branch prefix");

        assert_eq!(loaded, "custom-prefix");
    }
}
