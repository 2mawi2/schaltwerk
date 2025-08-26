use std::process::Command;
use std::path::Path;
// no serde derives used in this module
use crate::get_schaltwerk_core;
use crate::schaltwerk_core::{git, types::ChangedFile};
use std::collections::HashMap;
use crate::file_utils;
use crate::diff_engine::{
    compute_unified_diff, add_collapsible_sections, compute_split_diff,
    calculate_diff_stats, calculate_split_diff_stats, get_file_language,
    DiffResponse, SplitDiffResponse, FileInfo
};
use crate::binary_detection::{is_binary_file_by_extension, get_unsupported_reason};

#[tauri::command]
pub async fn get_changed_files_from_main(session_name: Option<String>) -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    git::get_changed_files(std::path::Path::new(&repo_path), &base_branch)
        .map_err(|e| format!("Failed to compute changed files: {e}"))
}

#[tauri::command]
pub async fn get_orchestrator_working_changes() -> Result<Vec<ChangedFile>, String> {
    let repo_path = get_repo_path(None).await?;
    
    let mut file_map: HashMap<String, String> = HashMap::new();
    
    // Get staged changes
    let staged_output = Command::new("git")
        .args([
            "-C", &repo_path,
            "diff", "--name-status", "--cached"
        ])
        .output()
        .map_err(|e| format!("Failed to get staged changes: {e}"))?;
    
    if staged_output.status.success() {
        for line in String::from_utf8_lossy(&staged_output.stdout).lines() {
            if let Some((status, path)) = parse_name_status_line(line) {
                file_map.insert(path.to_string(), status.to_string());
            }
        }
    }
    
    // Get unstaged changes
    let unstaged_output = Command::new("git")
        .args([
            "-C", &repo_path,
            "diff", "--name-status"
        ])
        .output()
        .map_err(|e| format!("Failed to get unstaged changes: {e}"))?;
    
    if unstaged_output.status.success() {
        for line in String::from_utf8_lossy(&unstaged_output.stdout).lines() {
            if let Some((status, path)) = parse_name_status_line(line) {
                // Don't override staged status if already present
                file_map.entry(path.to_string()).or_insert(status.to_string());
            }
        }
    }
    
    // Get untracked files
    let untracked_output = Command::new("git")
        .args([
            "-C", &repo_path,
            "ls-files", "--others", "--exclude-standard"
        ])
        .output()
        .map_err(|e| format!("Failed to get untracked files: {e}"))?;
    
    if untracked_output.status.success() {
        for line in String::from_utf8_lossy(&untracked_output.stdout).lines() {
            if !line.is_empty() {
                file_map.entry(line.to_string()).or_insert("A".to_string());
            }
        }
    }
    
    let mut changed_files: Vec<ChangedFile> = file_map
        .into_iter()
        .filter(|(path, _)| {
            // Filter out .schaltwerk directory and its contents
            !path.starts_with(".schaltwerk/") && path != ".schaltwerk"
        })
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
    
    Ok(changed_files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command;
    use tempfile::TempDir;

    fn setup_test_git_repo() -> TempDir {
        let temp_dir = TempDir::new().unwrap();
        let repo_path = temp_dir.path();

        // Initialize git repo
        Command::new("git")
            .args(["init"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Configure git
        Command::new("git")
            .args(["config", "user.name", "Test User"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        Command::new("git")
            .args(["config", "user.email", "test@example.com"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        // Create initial commit
        fs::write(repo_path.join("README.md"), "# Test repo").unwrap();
        Command::new("git")
            .args(["add", "README.md"])
            .current_dir(repo_path)
            .output()
            .unwrap();
        Command::new("git")
            .args(["commit", "-m", "Initial commit"])
            .current_dir(repo_path)
            .output()
            .unwrap();

        temp_dir
    }

    #[test]
    fn test_parse_name_status_line() {
        assert_eq!(parse_name_status_line("M\tfile.txt"), Some(("M", "file.txt")));
        assert_eq!(parse_name_status_line("A\tnew_file.txt"), Some(("A", "new_file.txt")));
        assert_eq!(parse_name_status_line("D\tdeleted.txt"), Some(("D", "deleted.txt")));
        assert_eq!(parse_name_status_line("invalid"), None);
        assert_eq!(parse_name_status_line(""), None);
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
        fs::write(repo_path.join(".schaltwerk/worktrees/test.txt"), "worktree content").unwrap();

        // Mock the get_repo_path function by testing the core logic directly
        let mut file_map: HashMap<String, String> = HashMap::new();
        
        // Simulate git output that would include .schaltwerk files
        file_map.insert("normal_file.txt".to_string(), "M".to_string());
        file_map.insert(".schaltwerk".to_string(), "A".to_string());
        file_map.insert(".schaltwerk/session.db".to_string(), "A".to_string());
        file_map.insert(".schaltwerk/worktrees/test.txt".to_string(), "A".to_string());

        let mut changed_files: Vec<ChangedFile> = file_map
            .into_iter()
            .filter(|(path, _)| {
                !path.starts_with(".schaltwerk/") && path != ".schaltwerk"
            })
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
            .filter(|(path, _)| {
                !path.starts_with(".schaltwerk/") && path != ".schaltwerk"
            })
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
            .filter(|(path, _)| {
                !path.starts_with(".schaltwerk/") && path != ".schaltwerk"
            })
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
        file_map.insert(".schaltwerk/worktrees/branch1/file.txt".to_string(), "A".to_string()); // Should be filtered
        file_map.insert("not_schaltwerk.txt".to_string(), "M".to_string()); // Should NOT be filtered
        file_map.insert("src/.schaltwerk_related.txt".to_string(), "A".to_string()); // Should NOT be filtered (different pattern)

        let mut changed_files: Vec<ChangedFile> = file_map
            .into_iter()
            .filter(|(path, _)| {
                !path.starts_with(".schaltwerk/") && path != ".schaltwerk"
            })
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

fn parse_name_status_line(line: &str) -> Option<(&str, &str)> {
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() >= 2 {
        Some((parts[0], parts[1]))
    } else {
        None
    }
}

#[tauri::command]
pub async fn get_file_diff_from_main(
    session_name: Option<String>, 
    file_path: String
) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    
    // Check if the worktree file is diffable
    let worktree_path = Path::new(&repo_path).join(&file_path);
    if worktree_path.exists() {
        let diff_info = file_utils::check_file_diffability(&worktree_path);
        if !diff_info.is_diffable {
            return Err(format!("Cannot diff file: {}", 
                diff_info.reason.unwrap_or_else(|| "Unknown reason".to_string())));
        }
    }
    
    // For commander (no session), get diff against HEAD (working changes)
    if session_name.is_none() {
        // Get the HEAD version of the file
        let base_content = Command::new("git")
            .args(["-C", &repo_path, "show", &format!("HEAD:{file_path}")])
            .output()
            .map_err(|e| format!("Failed to get HEAD content: {e}"))?;
        
        let base_text = if base_content.status.success() {
            let base_bytes = &base_content.stdout;
            if base_bytes.len() > 10 * 1024 * 1024 {
                return Err("Base file is too large to diff (>10MB)".to_string());
            }
            if base_bytes.contains(&0) || is_likely_binary(base_bytes) {
                return Err("Base file appears to be binary".to_string());
            }
            String::from_utf8_lossy(base_bytes).to_string()
        } else {
            String::new()
        };
        
        let worktree_text = if worktree_path.exists() {
            std::fs::read_to_string(worktree_path)
                .map_err(|e| format!("Failed to read worktree file: {e}"))?
        } else {
            String::new()
        };
        
        return Ok((base_text, worktree_text));
    }
    
    // For sessions, get diff against base branch
    let base_branch = get_base_branch(session_name).await?;
    
    // Check if the base file is diffable by trying to get it first
    let base_content = Command::new("git")
        .args(["-C", &repo_path, "show", &format!("{base_branch}:{file_path}")])
        .output()
        .map_err(|e| format!("Failed to get base content: {e}"))?;
    
    let base_text = if base_content.status.success() {
        // Check if the base content looks binary
        let base_bytes = &base_content.stdout;
        if base_bytes.len() > 10 * 1024 * 1024 {
            return Err("Base file is too large to diff (>10MB)".to_string());
        }
        if base_bytes.contains(&0) || is_likely_binary(base_bytes) {
            return Err("Base file appears to be binary".to_string());
        }
        String::from_utf8_lossy(base_bytes).to_string()
    } else {
        String::new()
    };
    
    let worktree_text = if worktree_path.exists() {
        std::fs::read_to_string(worktree_path)
            .map_err(|e| format!("Failed to read worktree file: {e}"))?
    } else {
        String::new()
    };
    
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
    
    let output = Command::new("git")
        .args(["-C", &repo_path, "branch", "--show-current"])
        .output()
        .map_err(|e| format!("Failed to get branch name: {e}"))?;
    
    if !output.status.success() {
        return Err(String::from_utf8_lossy(&output.stderr).to_string());
    }
    
    Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
}


#[tauri::command]
pub async fn get_commit_comparison_info(session_name: Option<String>) -> Result<(String, String), String> {
    let repo_path = get_repo_path(session_name.clone()).await?;
    let base_branch = get_base_branch(session_name).await?;
    
    let base_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", &base_branch])
        .output()
        .map_err(|e| format!("Failed to get base commit: {e}"))?;
    
    let base_commit = String::from_utf8_lossy(&base_output.stdout).trim().to_string();
    
    let head_output = Command::new("git")
        .args(["-C", &repo_path, "rev-parse", "--short", "HEAD"])
        .output()
        .map_err(|e| format!("Failed to get HEAD commit: {e}"))?;
    
    let head_commit = String::from_utf8_lossy(&head_output.stdout).trim().to_string();
    
    Ok((base_commit, head_commit))
}

async fn get_repo_path(session_name: Option<String>) -> Result<String, String> {
    if let Some(name) = session_name {
        let core = get_schaltwerk_core().await?;
        let core = core.lock().await;
        let manager = core.session_manager();
        
        let sessions = manager.list_enriched_sessions()
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
                current_dir.parent()
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
        
        let sessions = manager.list_enriched_sessions()
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
            crate::schaltwerk_core::git::get_default_branch(&project.path)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        } else {
            // Fallback for when no project is active (needed for Claude sessions)
            let current_dir = std::env::current_dir()
                .map_err(|e| format!("Failed to get current directory: {e}"))?;
            crate::schaltwerk_core::git::get_default_branch(&current_dir)
                .map_err(|e| format!("Failed to get default branch: {e}"))
        }
    }
}

#[tauri::command]
pub async fn compute_unified_diff_backend(
    session_name: Option<String>,
    file_path: String
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
    let (old_content, new_content) = get_file_diff_from_main(session_name, file_path.clone()).await?;
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
    file_path: String
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
    let (old_content, new_content) = get_file_diff_from_main(session_name, file_path.clone()).await?;
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


