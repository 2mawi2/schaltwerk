use super::connection::Database;
use anyhow::Result;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSelection {
    pub kind: String,
    pub payload: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ProjectSessionsSettings {
    pub filter_mode: String,
    pub sort_mode: String,
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
}

pub trait ProjectConfigMethods {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>>;
    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()>;
    fn get_project_selection(&self, repo_path: &Path) -> Result<Option<ProjectSelection>>;
    fn set_project_selection(&self, repo_path: &Path, selection: &ProjectSelection) -> Result<()>;
    fn get_project_sessions_settings(&self, repo_path: &Path) -> Result<ProjectSessionsSettings>;
    fn set_project_sessions_settings(
        &self,
        repo_path: &Path,
        settings: &ProjectSessionsSettings,
    ) -> Result<()>;
    fn get_project_environment_variables(
        &self,
        repo_path: &Path,
    ) -> Result<HashMap<String, String>>;
    fn set_project_environment_variables(
        &self,
        repo_path: &Path,
        env_vars: &HashMap<String, String>,
    ) -> Result<()>;
    fn get_project_action_buttons(&self, repo_path: &Path) -> Result<Vec<HeaderActionConfig>>;
    fn set_project_action_buttons(
        &self,
        repo_path: &Path,
        actions: &[HeaderActionConfig],
    ) -> Result<()>;
    fn get_project_run_script(&self, repo_path: &Path) -> Result<Option<RunScript>>;
    fn set_project_run_script(&self, repo_path: &Path, run_script: &RunScript) -> Result<()>;
}

impl ProjectConfigMethods for Database {
    fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();

        // Canonicalize the path for consistent storage/retrieval
        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT setup_script FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        match result {
            Ok(script) => Ok(Some(script)),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();

        // Canonicalize the path for consistent storage/retrieval
        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
            "INSERT INTO project_config (repository_path, setup_script, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(repository_path) DO UPDATE SET
                    setup_script = excluded.setup_script,
                    updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), setup_script, now, now],
        )?;

        Ok(())
    }

    fn get_project_selection(&self, repo_path: &Path) -> Result<Option<ProjectSelection>> {
        let conn = self.conn.lock().unwrap();

        // Canonicalize the path for consistent storage/retrieval
        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let result: rusqlite::Result<(Option<String>, Option<String>)> = conn.query_row(
                "SELECT last_selection_kind, last_selection_payload FROM project_config WHERE repository_path = ?1",
                params![canonical_path.to_string_lossy()],
                |row| Ok((row.get(0)?, row.get(1)?)),
            );

        match result {
            Ok((Some(kind), payload)) => Ok(Some(ProjectSelection { kind, payload })),
            Ok((None, _)) => Ok(None),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_selection(&self, repo_path: &Path, selection: &ProjectSelection) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();

        // Canonicalize the path for consistent storage/retrieval
        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
                "INSERT INTO project_config (repository_path, last_selection_kind, last_selection_payload, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(repository_path) DO UPDATE SET
                    last_selection_kind = excluded.last_selection_kind,
                    last_selection_payload = excluded.last_selection_payload,
                    updated_at = excluded.updated_at",
                params![
                    canonical_path.to_string_lossy(),
                    selection.kind,
                    selection.payload,
                    now,
                    now
                ],
            )?;

        Ok(())
    }

    fn get_project_sessions_settings(&self, repo_path: &Path) -> Result<ProjectSessionsSettings> {
        let conn = self.conn.lock().unwrap();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<(Option<String>, Option<String>)> = conn.query_row(
            "SELECT sessions_filter_mode, sessions_sort_mode
                FROM project_config
                WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );

        match query_res {
            Ok((filter_opt, sort_opt)) => Ok(ProjectSessionsSettings {
                filter_mode: filter_opt.unwrap_or_else(|| "all".to_string()),
                sort_mode: sort_opt.unwrap_or_else(|| "name".to_string()),
            }),
            Err(rusqlite::Error::QueryReturnedNoRows) => Ok(ProjectSessionsSettings {
                filter_mode: "all".to_string(),
                sort_mode: "name".to_string(),
            }),
            Err(e) => Err(e.into()),
        }
    }

    fn set_project_sessions_settings(
        &self,
        repo_path: &Path,
        settings: &ProjectSessionsSettings,
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        conn.execute(
            "INSERT INTO project_config (repository_path, sessions_filter_mode, sessions_sort_mode,
                                            created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4, ?5)
                ON CONFLICT(repository_path) DO UPDATE SET
                    sessions_filter_mode = excluded.sessions_filter_mode,
                    sessions_sort_mode   = excluded.sessions_sort_mode,
                    updated_at           = excluded.updated_at",
            params![
                canonical_path.to_string_lossy(),
                settings.filter_mode,
                settings.sort_mode,
                now,
                now,
            ],
        )?;

        Ok(())
    }

    fn get_project_environment_variables(
        &self,
        repo_path: &Path,
    ) -> Result<HashMap<String, String>> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let json_str = serde_json::to_string(env_vars)?;

        conn.execute(
            "INSERT INTO project_config (repository_path, environment_variables,
                                            created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(repository_path) DO UPDATE SET
                    environment_variables = excluded.environment_variables,
                    updated_at            = excluded.updated_at",
            params![canonical_path.to_string_lossy(), json_str, now, now],
        )?;

        Ok(())
    }

    fn get_project_action_buttons(&self, repo_path: &Path) -> Result<Vec<HeaderActionConfig>> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let json_str = serde_json::to_string(actions)?;

        conn.execute(
            "INSERT INTO project_config (repository_path, action_buttons, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(repository_path) DO UPDATE SET
                    action_buttons = excluded.action_buttons,
                    updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), json_str, now, now],
        )?;

        Ok(())
    }

    fn get_project_run_script(&self, repo_path: &Path) -> Result<Option<RunScript>> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let json_str = serde_json::to_string(run_script)?;

        conn.execute(
            "INSERT INTO project_config (repository_path, run_script, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4)
                ON CONFLICT(repository_path) DO UPDATE SET
                    run_script = excluded.run_script,
                    updated_at = excluded.updated_at",
            params![canonical_path.to_string_lossy(), json_str, now, now],
        )?;

        Ok(())
    }
}

impl Database {
    fn get_default_action_buttons() -> Vec<HeaderActionConfig> {
        vec![
                HeaderActionConfig {
                    id: "merge-reviewed".to_string(),
                    label: "Merge".to_string(),
                    prompt: "Find all reviewed sessions and merge them to the main branch with proper commit messages.".to_string(),
                    color: None,
                },
                HeaderActionConfig {
                    id: "create-pr".to_string(),
                    label: "PR".to_string(),
                    prompt: "Create a pull request for the current branch with a comprehensive description of changes.".to_string(),
                    color: None,
                },
                HeaderActionConfig {
                    id: "run-tests".to_string(),
                    label: "Test".to_string(),
                    prompt: "Run all tests and fix any failures that occur.".to_string(),
                    color: None,
                },
            ]
    }
}
