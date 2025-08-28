use std::path::Path;
use std::collections::{HashSet, HashMap};
use anyhow::Result;
use chrono::Utc;
use crate::schaltwerk_core::types::{GitStats, ChangedFile};
use std::fs;
use git2::{Repository, DiffOptions, StatusOptions, Oid};
use std::sync::{Mutex, OnceLock};


#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct StatsCacheKey {
    head: Option<Oid>,
    index_signature: Option<u64>,
    status_signature: u64,
}

type StatsCacheMap = HashMap<(std::path::PathBuf, String), (StatsCacheKey, GitStats)>;
static STATS_CACHE: OnceLock<Mutex<StatsCacheMap>> = OnceLock::new();

#[cfg(test)]
pub fn clear_stats_cache() {
    if let Some(cache) = STATS_CACHE.get() {
        cache.lock().unwrap().clear();
    }
}

pub fn calculate_git_stats_fast(worktree_path: &Path, parent_branch: &str) -> Result<GitStats> {
    let repo = Repository::discover(worktree_path)?;

    let head_oid = repo.head().ok().and_then(|h| h.target());
    let head_commit = head_oid.and_then(|oid| repo.find_commit(oid).ok());
    let head_tree = head_commit.as_ref().and_then(|c| c.tree().ok());

    let base_ref = repo.revparse_single(parent_branch).ok();
    let base_commit = base_ref
        .and_then(|obj| obj.peel_to_commit().ok());
    let base_tree = base_commit.as_ref().and_then(|c| c.tree().ok());

    let mut status_opts = StatusOptions::new();
    status_opts.include_untracked(true).recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut status_opts))?;
    let mut status_sig: u64 = 1469598103934665603;
    for entry in statuses.iter() {
        let s = entry.status().bits() as u64;
        status_sig ^= s.wrapping_mul(1099511628211);
        if let Some(path) = entry.path() {
            for b in path.as_bytes() { status_sig ^= (*b as u64).wrapping_mul(1099511628211); }
        }
    }

    let index_signature = repo.index().ok().map(|idx| {
        let mut sig: u64 = 1469598103934665603;
        for entry in idx.iter() {
            for b in entry.path.iter() { sig ^= (*b as u64).wrapping_mul(1099511628211); }
            let id = entry.id;
            for b in id.as_bytes() { sig ^= (*b as u64).wrapping_mul(1099511628211); }
        }
        sig
    });

    let key = StatsCacheKey { head: head_oid, index_signature, status_signature: status_sig };
    let cache_key = (worktree_path.to_path_buf(), parent_branch.to_string());
    if let Some(m) = STATS_CACHE.get() {
        if let Some((k, v)) = m.lock().unwrap().get(&cache_key) {
            if *k == key {
                // Fast-path: reuse cached counts, but recompute timestamp from git diff to avoid staleness
                // (status signature doesn't change when only mtimes change)
                // Latest committed change ahead of parent_branch
                let mut last_diff_change_ts: Option<i64> = None;
                if let (Some(base_commit), Some(head_commit)) = (base_commit.as_ref(), head_commit.as_ref()) {
                    if let Ok(merge_base_oid) = repo.merge_base(base_commit.id(), head_commit.id()) {
                        if repo.revparse(&format!("{merge_base_oid}..HEAD")).is_ok() {
                            if let Ok(mut revwalk) = repo.revwalk() {
                                revwalk.push_head().ok();
                                revwalk.hide(merge_base_oid).ok();
                                let latest_commit_ts = revwalk
                                    .filter_map(|oid| oid.ok())
                                    .filter_map(|oid| repo.find_commit(oid).ok())
                                    .map(|c| c.time().seconds())
                                    .max();
                                if let Some(ts) = latest_commit_ts { last_diff_change_ts = Some(ts); }
                            }
                        }
                    }
                }

                // Collect changed files (staged/unstaged/untracked) for mtime
                let mut files_for_mtime: HashSet<String> = HashSet::new();
                if let Some(ht) = head_tree.as_ref() {
                    if let Ok(idx) = repo.index() {
                        let mut staged_opts = DiffOptions::new();
                        // recurse_untracked_dirs is not relevant for tree->index; still keep options object
                        if let Ok(diff_for_mtime) = repo.diff_tree_to_index(Some(ht), Some(&idx), Some(&mut staged_opts)) {
                            for d in diff_for_mtime.deltas() {
                                if let Some(p) = d.new_file().path().or_else(|| d.old_file().path()) {
                                    if let Some(s) = p.to_str() { files_for_mtime.insert(s.to_string()); }
                                }
                            }
                        }
                    }
                }
                if let Ok(idx) = repo.index() {
                    let mut workdir_opts = DiffOptions::new();
                    workdir_opts.include_untracked(true).recurse_untracked_dirs(true);
                    if let Ok(diff_for_mtime) = repo.diff_index_to_workdir(Some(&idx), Some(&mut workdir_opts)) {
                        for d in diff_for_mtime.deltas() {
                            if let Some(p) = d.new_file().path().or_else(|| d.old_file().path()) {
                                if let Some(s) = p.to_str() { files_for_mtime.insert(s.to_string()); }
                            }
                        }
                    }
                }
                let mut latest_uncommitted_ts: Option<i64> = None;
                let mut saw_schema_change_cache: bool = false;
                for rel in files_for_mtime {
                    let abs = worktree_path.join(&rel);
                    if let Ok(metadata) = fs::metadata(&abs) {
                        if let Ok(modified) = metadata.modified() {
                            if let Ok(secs) = modified.duration_since(std::time::UNIX_EPOCH) {
                                let ts = secs.as_secs() as i64;
                                latest_uncommitted_ts = Some(latest_uncommitted_ts.map_or(ts, |cur| cur.max(ts)));
                            }
                        }
                    } else {
                        // Missing file likely indicates deletion/rename; mark to bump to now if needed
                        saw_schema_change_cache = true;
                    }
                }
                if let Some(u_ts) = latest_uncommitted_ts {
                    last_diff_change_ts = Some(match last_diff_change_ts { Some(c_ts) => c_ts.max(u_ts), None => u_ts });
                }
                if last_diff_change_ts.is_none() && saw_schema_change_cache {
                    last_diff_change_ts = Some(Utc::now().timestamp());
                }

                return Ok(GitStats {
                    session_id: v.session_id.clone(),
                    files_changed: v.files_changed,
                    lines_added: v.lines_added,
                    lines_removed: v.lines_removed,
                    has_uncommitted: v.has_uncommitted,
                    calculated_at: Utc::now(),
                    last_diff_change_ts,
                });
            }
        }
    }

    let mut files: HashSet<String> = HashSet::new();
    let mut files_for_mtime: HashSet<String> = HashSet::new();
    let mut insertions: u32 = 0;
    let mut deletions: u32 = 0;
    let mut saw_schema_change: bool = false;

    // Use the same single diff approach as get_changed_files for consistency
    // This shows net changes from base to current state
    let mut opts = DiffOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    if let Some(ref bt) = base_tree {
        if let Ok(diff) = repo.diff_tree_to_workdir_with_index(Some(bt), Some(&mut opts)) {
            // Calculate stats from the single comprehensive diff
            if let Ok(stats) = diff.stats() {
                insertions = stats.insertions() as u32;
                deletions = stats.deletions() as u32;
            }
            
            // Process deltas for file tracking and schema change detection
            for delta in diff.deltas() {
                use git2::Delta;
                match delta.status() {
                    Delta::Deleted | Delta::Renamed | Delta::Typechange => { saw_schema_change = true; }
                    _ => {}
                }
                
                if let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path()) {
                    if let Some(path_str) = path.to_str() {
                        files.insert(path_str.to_string());
                        files_for_mtime.insert(path_str.to_string());
                    }
                }
            }
        }
    }

    // Compute diff-aware last change timestamp
    let mut last_diff_change_ts: Option<i64> = None;

    // Latest committed change ahead of parent_branch
    if let (Some(base_commit), Some(head_commit)) = (base_commit.as_ref(), head_commit.as_ref()) {
        if let Ok(merge_base_oid) = repo.merge_base(base_commit.id(), head_commit.id()) {
            if repo.revparse(&format!("{merge_base_oid}..HEAD")).is_ok() {
                // Iterate commits in the range and take the most recent commit time (should be HEAD's time)
                if let Ok(mut revwalk) = repo.revwalk() {
                    revwalk.push_head().ok();
                    revwalk.hide(merge_base_oid).ok();
                    let latest_commit_ts = revwalk
                        .filter_map(|oid| oid.ok())
                        .filter_map(|oid| repo.find_commit(oid).ok())
                        .map(|c| c.time().seconds())
                        .max();
                    if let Some(ts) = latest_commit_ts { last_diff_change_ts = Some(ts); }
                }
            }
        }
    }

    // Latest mtime among changed-but-uncommitted files (staged, unstaged, untracked)
    let mut latest_uncommitted_ts: Option<i64> = None;
    for rel in files_for_mtime {
        let abs = worktree_path.join(&rel);
        if let Ok(metadata) = fs::metadata(&abs) {
            if let Ok(modified) = metadata.modified() {
                if let Ok(secs) = modified.duration_since(std::time::UNIX_EPOCH) {
                    let ts = secs.as_secs() as i64;
                    latest_uncommitted_ts = Some(latest_uncommitted_ts.map_or(ts, |cur| cur.max(ts)));
                }
            }
        }
    }
    if let Some(u_ts) = latest_uncommitted_ts {
        last_diff_change_ts = Some(match last_diff_change_ts { Some(c_ts) => c_ts.max(u_ts), None => u_ts });
    }
    // If we saw deletions/renames/type changes but couldn't get an mtime (e.g., deleted files), bump to now
    if last_diff_change_ts.is_none() && saw_schema_change {
        last_diff_change_ts = Some(Utc::now().timestamp());
    }

    let stats = GitStats {
        session_id: String::new(),
        files_changed: files.len() as u32,
        lines_added: insertions,
        lines_removed: deletions,
        has_uncommitted: !statuses.is_empty(),
        calculated_at: Utc::now(),
        last_diff_change_ts,
    };

    let map = STATS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    map.lock().unwrap().insert(cache_key, (key, stats.clone()));

    Ok(stats)
}


pub fn get_changed_files(worktree_path: &Path, parent_branch: &str) -> Result<Vec<ChangedFile>> {
    // For sessions, show all changes from base branch to current working directory state
    // This includes ALL changes: committed, staged, unstaged, and untracked files
    
    let repo = Repository::discover(worktree_path)?;
    
    // Get base branch commit and tree
    let base_ref = repo.revparse_single(parent_branch)
        .map_err(|e| anyhow::anyhow!("Failed to find base branch {}: {}", parent_branch, e))?;
    let base_commit = base_ref.peel_to_commit()
        .map_err(|e| anyhow::anyhow!("Failed to get base commit: {}", e))?;
    let base_tree = base_commit.tree()
        .map_err(|e| anyhow::anyhow!("Failed to get base tree: {}", e))?;
    
    // Use libgit2's diff_tree_to_workdir_with_index to get ALL changes in one operation
    // This directly compares base tree to working directory including staged changes
    let mut opts = DiffOptions::new();
    opts.include_untracked(true)
        .recurse_untracked_dirs(true)
        .ignore_submodules(true);
    
    let diff = repo.diff_tree_to_workdir_with_index(Some(&base_tree), Some(&mut opts))
        .map_err(|e| anyhow::anyhow!("Failed to compute diff: {}", e))?;
    
    let mut files = Vec::new();
    
    for delta in diff.deltas() {
        if let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path()) {
            if let Some(path_str) = path.to_str() {
                // Skip .schaltwerk directory
                if path_str.starts_with(".schaltwerk/") || path_str == ".schaltwerk" {
                    continue;
                }
                
                let change_type = match delta.status() {
                    git2::Delta::Added | git2::Delta::Untracked => "added",
                    git2::Delta::Deleted => "deleted", 
                    git2::Delta::Modified => "modified",
                    git2::Delta::Renamed => "renamed",
                    git2::Delta::Copied => "copied",
                    git2::Delta::Typechange => "modified",
                    _ => "modified",
                };
                
                files.push(ChangedFile {
                    path: path_str.to_string(),
                    change_type: change_type.to_string(),
                });
            }
        }
    }
    
    // Sort files alphabetically for consistent ordering
    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[cfg(test)]
pub fn parse_numstat_line(line: &str) -> Option<(u32, u32, &str)> {
    if line.is_empty() {
        return None;
    }
    
    let parts: Vec<&str> = line.split_whitespace().collect();
    if parts.len() < 3 {
        return None;
    }
    
    let added = if parts[0] == "-" { 0 } else { parts[0].parse().unwrap_or(0) };
    let removed = if parts[1] == "-" { 0 } else { parts[1].parse().unwrap_or(0) };
    let file = parts[2];
    
    Some((added, removed, file))
}