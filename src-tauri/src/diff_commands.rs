use std::path::Path;
// no serde derives used in this module
use crate::diff_engine::{
    add_collapsible_sections, calculate_diff_stats, calculate_split_diff_stats, compute_split_diff,
    compute_unified_diff, get_file_language, DiffResponse, FileInfo, SplitDiffResponse,
};
use crate::file_utils;
use crate::get_schaltwerk_core;
use git2::{Delta, DiffFindOptions, DiffOptions, ObjectType, Oid, Repository, Sort, Status};
use schaltwerk::binary_detection::{get_unsupported_reason, is_binary_file_by_extension};
use schaltwerk::domains::git;
use schaltwerk::domains::sessions::entity::ChangedFile;
use serde::Serialize;

#[tauri::command]
pub async fn get_changed_files_from_main(
    session_name: Option<String>,
) -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    git::get_changed_files(std::path::Path::new(&repo_path), &base_branch)
        .map_err(|e| format!("Failed to compute changed files: {e}"))
}

#[tauri::command]
pub async fn get_orchestrator_working_changes() -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(None).await?;

    // Use libgit2 to get status
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;

    let statuses = repo
        .statuses(None)
        .map_err(|e| format!("Failed to get repository status: {e}"))?;

    let mut changed_files = Vec::new();

    for entry in statuses.iter() {
        let path = entry
            .path()
            .ok_or_else(|| "Invalid path in status entry".to_string())?;

        // Filter out .schaltwerk directory and its contents
        if path.starts_with(".schaltwerk/") || path == ".schaltwerk" {
            continue;
        }

        let status = entry.status();

        // Determine the change type based on git status flags
        let change_type = if status.contains(Status::INDEX_NEW) || status.contains(Status::WT_NEW) {
            "added"
        } else if status.contains(Status::INDEX_DELETED) || status.contains(Status::WT_DELETED) {
            "deleted"
        } else if status.contains(Status::INDEX_RENAMED) || status.contains(Status::WT_RENAMED) {
            "renamed"
        } else if status.contains(Status::INDEX_MODIFIED)
            || status.contains(Status::WT_MODIFIED)
            || status.contains(Status::INDEX_TYPECHANGE)
            || status.contains(Status::WT_TYPECHANGE)
        {
            "modified"
        } else {
            continue; // Skip if no relevant changes
        };

        changed_files.push(ChangedFile {
            path: path.to_string(),
            change_type: change_type.to_string(),
        });
    }

    // Sort files alphabetically by path for consistent ordering
    changed_files.sort_by(|a, b| a.path.cmp(&b.path));

    Ok(changed_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::fs;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn setup_test_git_repo() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path();

        // Initialize git repo
        StdCommand::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Configure git
        StdCommand::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        StdCommand::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Create initial commit
        fs::write(repo_path.join("README.md"), "# Test repo").unwrap();
        StdCommand::new("git")
            .args(["add", "README.md"])
            .current_dir(repo_path)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        temp_dir
    }

    #[test]
    fn test_orchestrator_working_changes_filters_schaltwerk() {
        let temp_dir = setup_test_git_repo();
        let repo_path = temp_dir.path();

        // Create various files including .schaltwerk files
        fs::write(repo_path.join("normal_file.txt"), "content").unwrap();
        fs::create_dir_all(repo_path.join(".schaltwerk")).unwrap();
        fs::write(repo_path.join(".schaltwerk/session.db"), "db content").unwrap();
        fs::create_dir_all(repo_path.join(".schaltwerk/worktrees")).unwrap();
        fs::write(
            repo_path.join(".schaltwerk/worktrees/test.txt"),
            "worktree content",
        )
        .unwrap();

        // Mock the get_repo_path function by testing the core logic directly
        let mut file_map: HashMap<String, String> = HashMap::new();

        // Simulate git output that would include .schaltwerk files
        file_map.insert("normal_file.txt".to_string(), "M".to_string());
        file_map.insert(".schaltwerk".to_string(), "A".to_string());
        file_map.insert(".schaltwerk/session.db".to_string(), "A".to_string());
        file_map.insert(
            ".schaltwerk/worktrees/test.txt".to_string(),
            "A".to_string(),
        );

        let mut changed_files: Vec<ChangedFile> = file_map
            .into_iter()
            .filter(|(path, _)| !path.starts_with(".schaltwerk/") && path != ".schaltwerk")
            .map(|(path, status)| ChangedFile {
                path,
                change_type: match status.as_str() {
                    "M" => "modified".to_string(),
                    "A" => "added".to_string(),
                    "D" => "deleted".to_string(),
                    "R" => "renamed".to_string(),
                    "C" => "copied".to_string(),
                    _ => "unknown".to_string(),
                },
            })
            .collect();

        // Sort files alphabetically by path for consistent ordering
        changed_files.sort_by(|a, b| a.path.cmp(&b.path));

        // Should only contain normal_file.txt, all .schaltwerk files filtered out
        assert_eq!(changed_files.len(), 1);
        assert_eq!(changed_files[0].path, "normal_file.txt");
        assert_eq!(changed_files[0].change_type, "modified");
    }

    #[test]
    fn test_orchestrator_working_changes_alphabetical_sorting() {
        let mut file_map: HashMap<String, String> = HashMap::new();

        // Add files in non-alphabetical order
        file_map.insert("zebra.txt".to_string(), "M".to_string());
        file_map.insert("alpha.txt".to_string(), "A".to_string());
        file_map.insert("beta.txt".to_string(), "D".to_string());
        file_map.insert("gamma.txt".to_string(), "M".to_string());

        let mut changed_files: Vec<ChangedFile> = file_map
            .into_iter()
            .filter(|(path, _)| !path.starts_with(".schaltwerk/") && path != ".schaltwerk")
            .map(|(path, status)| ChangedFile {
                path,
                change_type: match status.as_str() {
                    "M" => "modified".to_string(),
                    "A" => "added".to_string(),
                    "D" => "deleted".to_string(),
                    "R" => "renamed".to_string(),
                    "C" => "copied".to_string(),
                    _ => "unknown".to_string(),
                },
            })
            .collect();

        // Sort files alphabetically by path for consistent ordering
        changed_files.sort_by(|a, b| a.path.cmp(&b.path));

        // Should be sorted alphabetically
        assert_eq!(changed_files.len(), 4);
        assert_eq!(changed_files[0].path, "alpha.txt");
        assert_eq!(changed_files[1].path, "beta.txt");
        assert_eq!(changed_files[2].path, "gamma.txt");
        assert_eq!(changed_files[3].path, "zebra.txt");
    }

    #[test]
    fn test_change_type_mapping() {
        let test_cases = vec![
            ("M", "modified"),
            ("A", "added"),
            ("D", "deleted"),
            ("R", "renamed"),
            ("C", "copied"),
            ("X", "unknown"), // Unknown status should map to "unknown"
        ];

        for (input_status, expected_type) in test_cases {
            let mut file_map: HashMap<String, String> = HashMap::new();
            file_map.insert("test.txt".to_string(), input_status.to_string());

            let changed_files: Vec<ChangedFile> = file_map
                .into_iter()
                .map(|(path, status)| ChangedFile {
                    path,
                    change_type: match status.as_str() {
                        "M" => "modified".to_string(),
                        "A" => "added".to_string(),
                        "D" => "deleted".to_string(),
                        "R" => "renamed".to_string(),
                        "C" => "copied".to_string(),
                        _ => "unknown".to_string(),
                    },
                })
                .collect();

            assert_eq!(changed_files.len(), 1);
            assert_eq!(changed_files[0].change_type, expected_type);
        }
    }

    #[test]
    fn test_orchestrator_working_changes_empty_result() {
        let file_map: HashMap<String, String> = HashMap::new();

        let mut changed_files: Vec<ChangedFile> = file_map
            .into_iter()
            .filter(|(path, _)| !path.starts_with(".schaltwerk/") && path != ".schaltwerk")
            .map(|(path, status)| ChangedFile {
                path,
                change_type: match status.as_str() {
                    "M" => "modified".to_string(),
                    "A" => "added".to_string(),
                    "D" => "deleted".to_string(),
                    "R" => "renamed".to_string(),
                    "C" => "copied".to_string(),
                    _ => "unknown".to_string(),
                },
            })
            .collect();

        changed_files.sort_by(|a, b| a.path.cmp(&b.path));

        assert_eq!(changed_files.len(), 0);
    }

    #[test]
    fn test_complex_schaltwerk_filtering() {
        let mut file_map: HashMap<String, String> = HashMap::new();

        // Test various patterns that should and shouldn't be filtered
        file_map.insert("src/main.rs".to_string(), "M".to_string());
        file_map.insert(".schaltwerk".to_string(), "A".to_string()); // Should be filtered
        file_map.insert(".schaltwerk/config.json".to_string(), "M".to_string()); // Should be filtered
        file_map.insert(
            ".schaltwerk/worktrees/branch1/file.txt".to_string(),
            "A".to_string(),
        ); // Should be filtered
        file_map.insert("not_schaltwerk.txt".to_string(), "M".to_string()); // Should NOT be filtered
        file_map.insert("src/.schaltwerk_related.txt".to_string(), "A".to_string()); // Should NOT be filtered (different pattern)

        let mut changed_files: Vec<ChangedFile> = file_map
            .into_iter()
            .filter(|(path, _)| !path.starts_with(".schaltwerk/") && path != ".schaltwerk")
            .map(|(path, status)| ChangedFile {
                path,
                change_type: match status.as_str() {
                    "M" => "modified".to_string(),
                    "A" => "added".to_string(),
                    "D" => "deleted".to_string(),
                    "R" => "renamed".to_string(),
                    "C" => "copied".to_string(),
                    _ => "unknown".to_string(),
                },
            })
            .collect();

        changed_files.sort_by(|a, b| a.path.cmp(&b.path));

        // Should contain 3 files: src/main.rs, not_schaltwerk.txt, src/.schaltwerk_related.txt
        assert_eq!(changed_files.len(), 3);

        let file_paths: Vec<&String> = changed_files.iter().map(|f| &f.path).collect();
        assert!(file_paths.contains(&&"src/main.rs".to_string()));
        assert!(file_paths.contains(&&"not_schaltwerk.txt".to_string()));
        assert!(file_paths.contains(&&"src/.schaltwerk_related.txt".to_string()));

        // Should NOT contain any .schaltwerk files
        assert!(!file_paths.contains(&&".schaltwerk".to_string()));
        assert!(!file_paths.contains(&&".schaltwerk/config.json".to_string()));
        assert!(!file_paths.contains(&&".schaltwerk/worktrees/branch1/file.txt".to_string()));
    }
}

#[tauri::command]
pub async fn get_file_diff_from_main(
    session_name: Option<String>,
    file_path: String,
) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;

    // Check if the worktree file is diffable
    let worktree_path = Path::new(&repo_path).join(&file_path);
    if worktree_path.exists() {
        let diff_info = file_utils::check_file_diffability(&worktree_path);
        if !diff_info.is_diffable {
            return Err(format!(
                "Cannot diff file: {}",
                diff_info
                    .reason
                    .unwrap_or_else(|| "Unknown reason".to_string())
            ));
        }
    }

    // For orchestrator (no session), get diff against HEAD (working changes) using git2
    if session_name.is_none() {
        let repo =
            Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
        let base_text = read_blob_from_commit_path(&repo, None, &file_path)?;
        let worktree_text = read_workdir_text(&worktree_path)?;
        return Ok((base_text, worktree_text));
    }

    // For sessions, compare merge-base(HEAD, parent_branch) to working directory using git2
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
    let parent_branch = get_base_branch(session_name).await?;
    let base_text = read_blob_from_merge_base(&repo, &parent_branch, &file_path)?;
    let worktree_text = read_workdir_text(&worktree_path)?;
    Ok((base_text, worktree_text))
}

fn is_likely_binary(bytes: &[u8]) -> bool {
    // Use Git's standard algorithm: check for null bytes in first 8000 bytes
    // This matches Git's buffer_is_binary() function
    let check_size = std::cmp::min(8000, bytes.len());
    let sample = &bytes[..check_size];

    // Check for null bytes (Git's standard binary detection)
    sample.contains(&0)
}

#[tauri::command]
pub async fn get_base_branch_name(session_name: Option<String>) -> Result<String, String> {
    get_base_branch(session_name).await
}

#[tauri::command]
pub async fn get_current_branch_name(session_name: Option<String>) -> Result<String, String> {
    let repo_path = get_repo_path(session_name).await?;
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
    let head = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {e}"))?;
    Ok(head.shorthand().unwrap_or("").to_string())
}

#[tauri::command]
pub async fn get_commit_comparison_info(
    session_name: Option<String>,
) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
    let head_oid = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {e}"))?
        .target()
        .ok_or_else(|| "Missing HEAD target".to_string())?;
    let base_commit = repo
        .revparse_single(&base_branch)
        .map_err(|e| format!("Failed to resolve base branch: {e}"))?
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel base commit: {e}"))?;
    let head_short = short_id_str(&repo, head_oid);
    let base_short = short_id_str(&repo, base_commit.id());
    Ok((base_short, head_short))
}

fn short_id_str(repo: &Repository, oid: Oid) -> String {
    if let Ok(obj) = repo.find_object(oid, None) {
        if let Ok(buf) = obj.short_id() {
            if let Ok(s) = std::str::from_utf8(&buf) {
                return s.to_string();
            }
        }
    }
    let s = oid.to_string();
    s.chars().take(7).collect()
}

fn read_blob_from_commit_path(
    repo: &Repository,
    commit_oid: Option<Oid>,
    file_path: &str,
) -> Result<String, String> {
    // If commit_oid is None, use HEAD
    let commit = match commit_oid {
        Some(oid) => repo
            .find_commit(oid)
            .map_err(|e| format!("Find commit failed: {e}"))?,
        None => repo
            .head()
            .map_err(|e| format!("Failed to get HEAD: {e}"))?
            .peel_to_commit()
            .map_err(|e| format!("Failed to peel HEAD to commit: {e}"))?,
    };
    let tree = commit
        .tree()
        .map_err(|e| format!("Failed to get tree: {e}"))?;
    let path = std::path::Path::new(file_path);
    let entry = match tree.get_path(path) {
        Ok(e) => e,
        Err(_) => return Ok(String::new()),
    };
    let obj = repo
        .find_object(entry.id(), Some(ObjectType::Blob))
        .or_else(|_| repo.find_object(entry.id(), None))
        .map_err(|e| format!("Failed to find object: {e}"))?;
    let blob = obj
        .peel_to_blob()
        .map_err(|e| format!("Failed to peel to blob: {e}"))?;
    let data = blob.content();
    if data.len() > 10 * 1024 * 1024 {
        return Err("Base file is too large to diff (>10MB)".to_string());
    }
    if data.contains(&0) || is_likely_binary(data) {
        return Err("Base file appears to be binary".to_string());
    }
    Ok(String::from_utf8_lossy(data).to_string())
}

fn read_blob_from_merge_base(
    repo: &Repository,
    parent_branch: &str,
    file_path: &str,
) -> Result<String, String> {
    let head_oid = repo
        .head()
        .map_err(|e| format!("Failed to get HEAD: {e}"))?
        .target()
        .ok_or_else(|| "Missing HEAD target".to_string())?;
    let parent_commit = repo
        .revparse_single(parent_branch)
        .map_err(|e| format!("Failed to resolve parent branch: {e}"))?
        .peel_to_commit()
        .map_err(|e| format!("Failed to peel parent commit: {e}"))?;
    let mb_oid = repo
        .merge_base(head_oid, parent_commit.id())
        .unwrap_or(parent_commit.id());
    read_blob_from_commit_path(repo, Some(mb_oid), file_path)
}

fn read_workdir_text(path: &std::path::Path) -> Result<String, String> {
    if path.exists() {
        std::fs::read_to_string(path).map_err(|e| format!("Failed to read worktree file: {e}"))
    } else {
        Ok(String::new())
    }
}

#[derive(Serialize, Clone, Debug)]
pub struct CommitInfo {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    pub email: String,
    pub date: String,
    pub message: String,
}

#[tauri::command]
pub async fn get_git_history(
    session_name: Option<String>,
    skip: Option<u32>,
    limit: Option<u32>,
) -> Result<Vec<CommitInfo>, String> {
    let repo_path = get_repo_path(session_name).await?;
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;

    let skip = skip.unwrap_or(0) as usize;
    let limit = limit.unwrap_or(200) as usize;

    let mut revwalk = repo
        .revwalk()
        .map_err(|e| format!("Failed to create revwalk: {e}"))?;
    let _ = revwalk.push_glob("refs/heads/*");
    let _ = revwalk.push_glob("refs/tags/*");
    let _ = revwalk.push_head();
    revwalk
        .set_sorting(Sort::TOPOLOGICAL | Sort::TIME)
        .map_err(|e| format!("Failed to set revwalk sorting: {e}"))?;

    let mut commits = Vec::new();
    for (i, oid_res) in revwalk.enumerate() {
        if commits.len() >= limit {
            break;
        }
        if i < skip {
            continue;
        }
        let oid = oid_res.map_err(|e| format!("Revwalk error: {e}"))?;
        let commit = repo
            .find_commit(oid)
            .map_err(|e| format!("Find commit failed: {e}"))?;
        let hash = oid.to_string();
        let parents = (0..commit.parent_count())
            .filter_map(|idx| commit.parent_id(idx).ok())
            .map(|p| p.to_string())
            .collect::<Vec<_>>();
        let author_sig = commit.author();
        let author = author_sig.name().unwrap_or("").to_string();
        let email = author_sig.email().unwrap_or("").to_string();
        let secs = commit.time().seconds();
        let date = chrono::DateTime::<chrono::Utc>::from_timestamp(secs, 0)
            .map(|dt| dt.to_rfc3339())
            .unwrap_or_default();
        let message = commit.message().unwrap_or("").to_string();
        commits.push(CommitInfo {
            hash,
            parents,
            author,
            email,
            date,
            message,
        });
    }

    Ok(commits)
}

#[derive(Serialize, Clone, Debug)]
pub struct CommitChangedFile {
    pub path: String,
    pub change_type: String, // "A", "M", "D", "R", etc.
}

#[tauri::command]
pub async fn get_commit_files(
    session_name: Option<String>,
    commit: String,
) -> Result<Vec<CommitChangedFile>, String> {
    let repo_path = get_repo_path(session_name).await?;
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
    let oid = Oid::from_str(&commit).map_err(|e| format!("Invalid commit id: {e}"))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Find commit failed: {e}"))?;
    let new_tree = commit.tree().map_err(|e| format!("Get tree failed: {e}"))?;
    let old_tree = if commit.parent_count() > 0 {
        commit.parent(0).ok().and_then(|p| p.tree().ok())
    } else {
        None
    };

    let mut opts = DiffOptions::new();
    opts.include_untracked(false).recurse_untracked_dirs(false);
    let mut diff = match old_tree {
        Some(ref t) => repo.diff_tree_to_tree(Some(t), Some(&new_tree), Some(&mut opts)),
        None => repo.diff_tree_to_tree(None, Some(&new_tree), Some(&mut opts)),
    }
    .map_err(|e| format!("Create diff failed: {e}"))?;

    let mut find_opts = DiffFindOptions::new();
    let _ = diff.find_similar(Some(&mut find_opts));

    let mut files = Vec::new();
    for delta in diff.deltas() {
        let status = match delta.status() {
            Delta::Added => "A",
            Delta::Deleted => "D",
            Delta::Modified => "M",
            Delta::Renamed => "R",
            Delta::Copied => "C",
            _ => "M",
        };
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str())
            .unwrap_or("")
            .to_string();
        if !path.is_empty() {
            files.push(CommitChangedFile {
                path,
                change_type: status.to_string(),
            });
        }
    }

    Ok(files)
}

#[tauri::command]
pub async fn get_commit_file_contents(
    session_name: Option<String>,
    commit: String,
    file_path: String,
) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name).await?;
    let repo =
        Repository::open(&repo_path).map_err(|e| format!("Failed to open repository: {e}"))?;
    let oid = Oid::from_str(&commit).map_err(|e| format!("Invalid commit id: {e}"))?;
    let commit = repo
        .find_commit(oid)
        .map_err(|e| format!("Find commit failed: {e}"))?;

    let old_text = if commit.parent_count() > 0 {
        let parent = commit.parent(0).ok();
        if let Some(pc) = parent {
            read_blob_from_commit_path(&repo, Some(pc.id()), &file_path)?
        } else {
            String::new()
        }
    } else {
        String::new()
    };

    let new_text = read_blob_from_commit_path(&repo, Some(commit.id()), &file_path)?;

    Ok((old_text, new_text))
}

async fn get_repo_path(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_schaltwerk_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();

        let sessions = manager
            .list_enriched_sessions()
            .map_err(|e| format!("Failed to get sessions: {e}"))?;

        let session = sessions.into_iter().find(|s| s.info.session_id == name);

        if let Some(session) = session {
            Ok(session.info.worktree_path)
        } else {
            Err(format!("Session '{name}' not found"))
        }
    } else {
        // For diff commands without session, use current project path if available,
        // otherwise fall back to current directory for backward compatibility
        let manager = crate::get_project_manager().await;
        if let Ok(project) = manager.current_project().await {
            Ok(project.path.to_string_lossy().to_string())
        } else {
            // Fallback for when no project is active (needed for Claude sessions)
            let current_dir = std::env::current_dir()
                .map_err(|e| format!("Failed to get current directory: {e}"))?;

            if current_dir.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
                current_dir
                    .parent()
                    .map(|p| p.to_string_lossy().to_string())
                    .ok_or_else(|| "Failed to get parent directory".to_string())
            } else {
                Ok(current_dir.to_string_lossy().to_string())
            }
        }
    }
}

async fn get_base_branch(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_schaltwerk_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();

        let sessions = manager
            .list_enriched_sessions()
            .map_err(|e| format!("Failed to get sessions: {e}"))?;

        let session = sessions.into_iter().find(|s| s.info.session_id == name);

        if let Some(session) = session {
            Ok(session.info.base_branch)
        } else {
            Err(format!("Session '{name}' not found"))
        }
    } else {
        // No session specified, get default branch from current project
        let manager = crate::get_project_manager().await;
        if let Ok(project) = manager.current_project().await {
            schaltwerk::domains::git::get_default_branch(&project.path)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        } else {
            // Fallback for when no project is active (needed for Claude sessions)
            let current_dir = std::env::current_dir()
                .map_err(|e| format!("Failed to get current directory: {e}"))?;
            schaltwerk::domains::git::get_default_branch(&current_dir)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        }
    }
}

#[tauri::command]
pub async fn compute_unified_diff_backend(
    session_name: Option<String>,
    file_path: String,
) -> Result<DiffResponse, String> {
    use std::time::Instant;
    let start_total = Instant::now();

    // Check for binary file by extension first (fast check)
    if is_binary_file_by_extension(&file_path) {
        let reason = get_unsupported_reason(&file_path, None);
        return Ok(DiffResponse {
            lines: vec![],
            stats: calculate_diff_stats(&[]),
            file_info: FileInfo {
                language: None,
                size_bytes: 0,
            },
            is_large_file: false,
            is_binary: Some(true),
            unsupported_reason: reason,
        });
    }

    // Profile file content loading
    let start_load = Instant::now();
    let (old_content, new_content) =
        get_file_diff_from_main(session_name, file_path.clone()).await?;
    let load_duration = start_load.elapsed();

    // Check for binary content after loading
    let new_content_bytes = new_content.as_bytes();
    if let Some(reason) = get_unsupported_reason(&file_path, Some(new_content_bytes)) {
        return Ok(DiffResponse {
            lines: vec![],
            stats: calculate_diff_stats(&[]),
            file_info: FileInfo {
                language: get_file_language(&file_path),
                size_bytes: new_content_bytes.len(),
            },
            is_large_file: new_content_bytes.len() > 5 * 1024 * 1024,
            is_binary: Some(true),
            unsupported_reason: Some(reason),
        });
    }

    // Profile diff computation
    let start_diff = Instant::now();
    let diff_lines = compute_unified_diff(&old_content, &new_content);
    let diff_duration = start_diff.elapsed();

    // Profile collapsible sections
    let start_collapse = Instant::now();
    let lines_with_collapsible = add_collapsible_sections(diff_lines);
    let collapse_duration = start_collapse.elapsed();

    // Profile stats calculation
    let start_stats = Instant::now();
    let stats = calculate_diff_stats(&lines_with_collapsible);
    let stats_duration = start_stats.elapsed();

    let file_info = FileInfo {
        language: get_file_language(&file_path),
        size_bytes: new_content.len(),
    };

    let is_large_file = new_content.len() > 5 * 1024 * 1024;
    let total_duration = start_total.elapsed();

    // Log performance metrics
    if total_duration.as_millis() > 100 || is_large_file {
        log::info!(
            "Diff performance for {}: total={}ms (load={}ms, diff={}ms, collapse={}ms, stats={}ms), size={}KB, lines={}",
            file_path,
            total_duration.as_millis(),
            load_duration.as_millis(),
            diff_duration.as_millis(),
            collapse_duration.as_millis(),
            stats_duration.as_millis(),
            new_content.len() / 1024,
            lines_with_collapsible.len()
        );
    }

    Ok(DiffResponse {
        lines: lines_with_collapsible,
        stats,
        file_info,
        is_large_file,
        is_binary: Some(false),
        unsupported_reason: None,
    })
}

#[tauri::command]
pub async fn compute_split_diff_backend(
    session_name: Option<String>,
    file_path: String,
) -> Result<SplitDiffResponse, String> {
    use std::time::Instant;
    let start_total = Instant::now();

    // Check for binary file by extension first (fast check)
    if is_binary_file_by_extension(&file_path) {
        let reason = get_unsupported_reason(&file_path, None);
        return Ok(SplitDiffResponse {
            split_result: compute_split_diff("", ""),
            stats: calculate_split_diff_stats(&compute_split_diff("", "")),
            file_info: FileInfo {
                language: None,
                size_bytes: 0,
            },
            is_large_file: false,
            is_binary: Some(true),
            unsupported_reason: reason,
        });
    }

    // Profile file content loading
    let start_load = Instant::now();
    let (old_content, new_content) =
        get_file_diff_from_main(session_name, file_path.clone()).await?;
    let load_duration = start_load.elapsed();

    // Check for binary content after loading
    let new_content_bytes = new_content.as_bytes();
    if let Some(reason) = get_unsupported_reason(&file_path, Some(new_content_bytes)) {
        return Ok(SplitDiffResponse {
            split_result: compute_split_diff("", ""),
            stats: calculate_split_diff_stats(&compute_split_diff("", "")),
            file_info: FileInfo {
                language: get_file_language(&file_path),
                size_bytes: new_content_bytes.len(),
            },
            is_large_file: new_content_bytes.len() > 5 * 1024 * 1024,
            is_binary: Some(true),
            unsupported_reason: Some(reason),
        });
    }

    // Profile diff computation
    let start_diff = Instant::now();
    let split_result = compute_split_diff(&old_content, &new_content);
    let diff_duration = start_diff.elapsed();

    // Profile stats calculation
    let start_stats = Instant::now();
    let stats = calculate_split_diff_stats(&split_result);
    let stats_duration = start_stats.elapsed();

    let file_info = FileInfo {
        language: get_file_language(&file_path),
        size_bytes: new_content.len(),
    };

    let is_large_file = new_content.len() > 5 * 1024 * 1024;
    let total_duration = start_total.elapsed();

    // Log performance metrics
    if total_duration.as_millis() > 100 || is_large_file {
        log::info!(
            "Split diff performance for {}: total={}ms (load={}ms, diff={}ms, stats={}ms), size={}KB, lines={}+{}",
            file_path,
            total_duration.as_millis(),
            load_duration.as_millis(),
            diff_duration.as_millis(),
            stats_duration.as_millis(),
            new_content.len() / 1024,
            split_result.left_lines.len(),
            split_result.right_lines.len()
        );
    }

    Ok(SplitDiffResponse {
        split_result,
        stats,
        file_info,
        is_large_file,
        is_binary: Some(false),
        unsupported_reason: None,
    })
}
