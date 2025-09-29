use super::connection::Database;
use anyhow::Result;
use chrono::Utc;
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::Path;

pub const DEFAULT_BRANCH_PREFIX: &str = "schaltwerk";

fn normalize_branch_prefix(input: &str) -> String {
    let trimmed = input.trim();
    let trimmed = trimmed.trim_matches('/');
    let normalized = trimmed.trim();
    if normalized.is_empty() {
        DEFAULT_BRANCH_PREFIX.to_string()
    } else {
        normalized.to_string()
    }
}

const SQUASH_MERGE_MAIN_PROMPT: &str = r#"Task: Squash-merge all reviewed Schaltwerk sessions

Find all reviewed sessions and merge them to main branch with proper validation and fallback handling.

Steps to perform:

1. Check git status: Ensure working tree is clean and on main branch
2. Find reviewed sessions: Use schaltwerk MCP to list all sessions with status="reviewed"
3. For each reviewed session:
  - IMPORTANT: First merge main INTO the session branch to resolve conflicts
  - Check if session branch exists and has valid changes (not regressions)
  - Switch to session branch (or use worktree if exists)
  - Check if there are any uncommited changes and commit them if needed (ensure to not commit any development artifacts like debug scripts etc that should not be in the changeset of the session)
  - Run git merge main to bring branch up to date with latest changes
  - Resolve any merge conflicts that occur
  - Switch back to main branch
  - Validate session before merge:
      - CRITICAL: Use git log --oneline main..schaltwerk/session_name to see what commits the session actually adds
      - CRITICAL: If the session only has a "Mark session as reviewed" commit and NO actual feature commits, check for uncommitted changes in the worktree
      - CRITICAL: After merging main into the session, the diff will show the session "removing" files that were added to main after the session was created - THIS IS NORMAL and not the session actually removing anything
      - Focus on what the session ADDS (new files, modifications to existing files at the time of branch creation)
  - Attempt squash-merge: git merge --squash <branch>
  - Create descriptive commit message based on the session's changes
  - Run tests: Execute npm run test after merge attempt
  - Decision point:
      - ✅ If merge succeeds AND tests pass: Cancel session immediately with force: true
      - ❌ If merge fails OR tests fail OR changes don't make sense: Send follow-up message and NEVER cancel session

Understanding Git Diffs After Merging Main:

CRITICAL: When you merge main into an old session branch and then diff:
- Files that appear to be "removed" by the session are actually files added to main AFTER the session was created
- The session is NOT removing these files - they simply didn't exist when the session branched off
- Focus on:
  - Files the session ADDS (new files created by the session)
  - Files the session MODIFIES (changes to files that existed when the session was created)
  - Ignore apparent "deletions" of files that were added to main after the session's branch point

Example: If session branched from commit A, and main has since added files X and Y:
- After merging main into session, git diff main..session will show files X and Y as "deleted"
- This is NORMAL - the session isn't deleting them, it just shows the difference
- When you squash-merge back to main, files X and Y will remain intact

Validation Criteria:

✅ PROCEED WITH MERGE when:
- Small merge conflicts that can be resolved mechanically
- Integration issues between 2 features that need coordination (agent can't solve alone)
- Clean diff that makes logical sense (ignoring false "deletions" from main's newer files)
- Tests pass after merge
- No obvious regressions or broken functionality

❌ SEND FOLLOW-UP MESSAGE when:
- Code compilation fails (linting errors, missing imports, dead code warnings)
- Tests fail after merge due to integration issues between the new feature and existing functionality
- Large/complex merge conflicts that require domain knowledge
- Diff doesn't make sense (random changes, unrelated modifications, broken logic)
- Obvious regressions (reverting recent improvements that existed when the session was created)
- Missing proper integration (changes that should work together but don't)

❓ ASK USER FOR GUIDANCE when:
- Content duplication (session duplicates work from another session)
- Unclear session purpose (session name doesn't match actual changes)
- Strategic decisions needed (which of multiple similar sessions should be kept)

Follow-up Message Strategy:

For technical issues that agents can fix, send a descriptive follow-up message explaining:
- Specific issue encountered (compilation error, test failures, merge conflicts)
- What needs to be fixed (resolve dead code, fix integration, handle conflicts)
- Why it couldn't be auto-merged (requires agent knowledge/context)

Example messages:
"The session has compilation conflicts when merged to main. Please resolve the dead code issues with parse_numstat_line function and ensure all exports are properly scoped with #[cfg(test)]."

"Tests fail after merge due to integration issues between the new feature and existing functionality. Please ensure proper integration and test compatibility."

"The diff contains complex merge conflicts that require domain knowledge to resolve properly. Please rebase against main and resolve conflicts."

For strategic/content issues, ask the user for guidance at the end of the merge process:
- Leave the session as-is (don't send messages to agents for issues they can't solve)
- Present the issue to the user with context and options
- Let the user decide how to handle duplication, unclear purpose, etc.

Requirements:

- Working tree must be clean before starting
- Must be on main branch
- Only merge sessions that pass all validation criteria
- Send follow-up messages for problematic sessions (don't force merge)
- CRITICAL: Sessions cancelled immediately ONLY after successful merge and test validation
- NEVER cancel/delete sessions that failed to merge - preserve all Git state for manual review
- When you are done with everything, check again if there are new reviewed sessions and then also repeat this whole process from the beginning if there are any new reviewed sessions that you did not consider before
- When you had to send a follow-up message, you can continue with the other tasks in the meantime to be merged, so that the agent has time to actually process the follow-up message you sent it to him. Because if you do not wait, then there might not be changes immediately.

⚠️ Decision Making Philosophy:

- We handle: Simple conflicts, integration coordination, mechanical merges
- Agent handles: Complex conflicts, code logic issues, feature-specific problems
- User handles: Content duplication decisions, strategic choices, session purpose clarification
- When in doubt: Send follow-up message for technical issues, ask user for strategic issues
- Git State Protection: NEVER delete/cancel sessions unless they were successfully merged - all failed merges preserve their Git state

Commit message format:

Use the session's changes to create a meaningful commit message that describes what was implemented or fixed.

Please proceed with finding and validating all reviewed sessions systematically.

Git Recovery & Session Safety

🚨 CRITICAL: Never cancel sessions without merging first!

Prevention:
- Always run git merge --squash <branch> AND npm run test before cancelling
- Only cancel after successful merge + green tests

Recovery (if commits exist):
# Check if commits still exist in git database
git cat-file -t <commit-hash> 2>/dev/null && echo "Recoverable!"

# Recover from commit hash
git checkout -b recover-session <commit-hash>

# Merge to main
git checkout main && git merge --squash recover-session
git commit -m "Recover lost session: <description>"

⚠️ Remember: Uncommitted changes in worktrees are permanently lost when cancelled - commits in git database can be recovered."#;
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

    fn get_project_branch_prefix(&self, repo_path: &Path) -> Result<String> {
        let conn = self.conn.lock().unwrap();

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
        let conn = self.conn.lock().unwrap();
        let now = Utc::now().timestamp();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let normalized = normalize_branch_prefix(branch_prefix);

        conn.execute(
            "INSERT INTO project_config (repository_path, branch_prefix, created_at, updated_at)
                VALUES (?1, ?2, ?3, ?4)
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

    fn get_project_merge_preferences(&self, repo_path: &Path) -> Result<ProjectMergePreferences> {
        let conn = self.conn.lock().unwrap();

        let canonical_path =
            std::fs::canonicalize(repo_path).unwrap_or_else(|_| repo_path.to_path_buf());

        let query_res: rusqlite::Result<Option<i64>> = conn.query_row(
            "SELECT auto_cancel_after_merge FROM project_config WHERE repository_path = ?1",
            params![canonical_path.to_string_lossy()],
            |row| row.get(0),
        );

        let auto_cancel = match query_res {
            Ok(Some(value)) => value != 0,
            Ok(None) | Err(rusqlite::Error::QueryReturnedNoRows) => false,
            Err(e) => return Err(e.into()),
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
        let conn = self.conn.lock().unwrap();
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
                id: "squash-merge-main".to_string(),
                label: "Squash Merge Main".to_string(),
                prompt: SQUASH_MERGE_MAIN_PROMPT.to_string(),
                color: Some("green".to_string()),
            },
            HeaderActionConfig {
                id: "create-pr".to_string(),
                label: "PR".to_string(),
                prompt: "Create a pull request for the current branch with a comprehensive description of changes.".to_string(),
                color: Some("blue".to_string()),
            },
            HeaderActionConfig {
                id: "run-tests".to_string(),
                label: "Test".to_string(),
                prompt: "Run all tests and fix any failures that occur.".to_string(),
                color: Some("amber".to_string()),
            },
        ]
    }
}

pub fn default_action_buttons() -> Vec<HeaderActionConfig> {
    Database::get_default_action_buttons()
}
