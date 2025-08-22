    use rusqlite::params;
    use std::path::Path;
    use std::collections::HashMap;
    use anyhow::Result;
    use chrono::Utc;
    use crate::para_core::database::Database;
    use serde::{Serialize, Deserialize};

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

    pub trait ProjectConfigMethods {
        fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>>;
        fn set_project_setup_script(&self, repo_path: &Path, setup_script: &str) -> Result<()>;
        fn get_project_selection(&self, repo_path: &Path) -> Result<Option<ProjectSelection>>;
        fn set_project_selection(&self, repo_path: &Path, selection: &ProjectSelection) -> Result<()>;
        fn get_project_sessions_settings(&self, repo_path: &Path) -> Result<ProjectSessionsSettings>;
        fn set_project_sessions_settings(&self, repo_path: &Path, settings: &ProjectSessionsSettings) -> Result<()>;
        fn get_project_environment_variables(&self, repo_path: &Path) -> Result<HashMap<String, String>>;
        fn set_project_environment_variables(&self, repo_path: &Path, env_vars: &HashMap<String, String>) -> Result<()>;
    }

    impl ProjectConfigMethods for Database {
        fn get_project_setup_script(&self, repo_path: &Path) -> Result<Option<String>> {
            let conn = self.conn.lock().unwrap();
            
            // Canonicalize the path for consistent storage/retrieval
            let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
            
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
            let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
            
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
            let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
            
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
            let canonical_path = std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());
            
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
                    sort_mode:   sort_opt.unwrap_or_else(|| "name".to_string()),
                }),
                Err(rusqlite::Error::QueryReturnedNoRows) => Ok(ProjectSessionsSettings {
                    filter_mode: "all".to_string(),
                    sort_mode:   "name".to_string(),
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
            let now  = Utc::now().timestamp();

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
            env_vars:  &HashMap<String, String>,
        ) -> Result<()> {
            let conn = self.conn.lock().unwrap();
            let now  = Utc::now().timestamp();

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
        
    }