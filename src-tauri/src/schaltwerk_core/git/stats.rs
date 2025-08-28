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
    let base_commit = base_ref.and_then(|obj| obj.peel_to_commit().ok());
    // Use merge-base between HEAD and parent_branch to represent the baseline
    let base_tree = match (base_commit.as_ref(), head_commit.as_ref()) {
        (Some(base_c), Some(head_c)) => {
            if let Ok(merge_base_oid) = repo.merge_base(base_c.id(), head_c.id()) {
                repo.find_commit(merge_base_oid).ok().and_then(|c| c.tree().ok())
            } else {
                None
            }
        }
        _ => None,
    };

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

    // Latest committed change ahead of parent_branch (relative to merge-base)
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
    // Show all changes introduced by this worktree: committed + uncommitted
    // Baseline = merge-base(HEAD, parent_branch); Target = workdir with index
    let repo = Repository::discover(worktree_path)?;

    // Resolve HEAD and parent_branch commits
    let head_oid = repo.head().ok().and_then(|h| h.target());
    let base_ref = repo.revparse_single(parent_branch).ok();
    let base_commit = base_ref.and_then(|obj| obj.peel_to_commit().ok());

    // Determine baseline tree from merge-base(HEAD, parent)
    let baseline_tree = match (head_oid, base_commit.as_ref()) {
        (Some(h), Some(parent)) => {
            if let Ok(mb) = repo.merge_base(h, parent.id()) {
                repo.find_commit(mb).ok().and_then(|c| c.tree().ok())
            } else {
                parent.tree().ok()
            }
        }
        _ => None,
    };

    let mut files = Vec::new();

    if let Some(base_tree) = baseline_tree {
        let mut opts = DiffOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .ignore_submodules(true);

        let diff = repo
            .diff_tree_to_workdir_with_index(Some(&base_tree), Some(&mut opts))?;

        for delta in diff.deltas() {
            if let Some(path) = delta
                .new_file()
                .path()
                .or_else(|| delta.old_file().path())
                .and_then(|p| p.to_str())
            {
                // Skip .schaltwerk directory
                if path.starts_with(".schaltwerk/") || path == ".schaltwerk" {
                    continue;
                }

                let change_type = match delta.status() {
                    git2::Delta::Added | git2::Delta::Untracked => "added",
                    git2::Delta::Deleted => "deleted",
                    git2::Delta::Modified | git2::Delta::Typechange => "modified",
                    git2::Delta::Renamed => "renamed",
                    git2::Delta::Copied => "copied",
                    _ => "modified",
                };

                files.push(ChangedFile {
                    path: path.to_string(),
                    change_type: change_type.to_string(),
                });
            }
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::process::Command as StdCommand;
    use std::fs;

    fn init_repo() -> TempDir {
        clear_stats_cache();
        let temp = TempDir::new().unwrap();
        let p = temp.path();
        StdCommand::new("git").args(["init"]).current_dir(p).output().unwrap();
        StdCommand::new("git").args(["config","user.name","Test"]).current_dir(p).output().unwrap();
        StdCommand::new("git").args(["config","user.email","t@example.com"]).current_dir(p).output().unwrap();
        fs::write(p.join("README.md"), "root\n").unwrap();
        StdCommand::new("git").args(["add","."]).current_dir(p).output().unwrap();
        StdCommand::new("git").args(["commit","-m","init"]).current_dir(p).output().unwrap();
        // Rename default branch to main for consistency
        let cur = StdCommand::new("git").args(["rev-parse","--abbrev-ref","HEAD"]).current_dir(p).output().unwrap();
        let cur_name = String::from_utf8_lossy(&cur.stdout).trim().to_string();
        if cur_name != "main" && !cur_name.is_empty() {
            StdCommand::new("git").args(["branch","-m",&cur_name,"main"]).current_dir(p).output().unwrap();
        }
        temp
    }

    #[test]
    fn includes_committed_and_uncommitted_from_worktree() {
        let repo = init_repo();
        let p = repo.path();

        // Create feature branch
        StdCommand::new("git").args(["checkout","-b","feature"]).current_dir(p).output().unwrap();

        // Commit a file on feature
        fs::write(p.join("committed.txt"), "hello\n").unwrap();
        StdCommand::new("git").args(["add","committed.txt"]).current_dir(p).output().unwrap();
        StdCommand::new("git").args(["commit","-m","add committed"]).current_dir(p).output().unwrap();

        // Create uncommitted changes
        fs::write(p.join("untracked.txt"), "u\n").unwrap();
        fs::write(p.join("README.md"), "root-mod\n").unwrap();

        let files = get_changed_files(p, "main").unwrap();
        let paths: std::collections::HashSet<_> = files.iter().map(|f| f.path.as_str()).collect();

        assert!(paths.contains("committed.txt"), "should include committed change relative to main");
        assert!(paths.contains("untracked.txt"), "should include untracked file");
        assert!(paths.contains("README.md"), "should include modified working file");
    }

    #[test]
    fn excludes_changes_only_on_parent() {
        let repo = init_repo();
        let p = repo.path();

        // Branch and make a feature commit
        StdCommand::new("git").args(["checkout","-b","feature"]).current_dir(p).output().unwrap();
        fs::write(p.join("feat.txt"), "f\n").unwrap();
        StdCommand::new("git").args(["add","feat.txt"]).current_dir(p).output().unwrap();
        StdCommand::new("git").args(["commit","-m","feat"]).current_dir(p).output().unwrap();

        // Simulate main moving ahead with an unrelated commit (not merged)
        StdCommand::new("git").args(["checkout","main"]).current_dir(p).output().unwrap();
        fs::write(p.join("only_main.txt"), "m\n").unwrap();
        StdCommand::new("git").args(["add","only_main.txt"]).current_dir(p).output().unwrap();
        StdCommand::new("git").args(["commit","-m","main ahead"]).current_dir(p).output().unwrap();

        // Back to feature, compute changes vs main using merge-base
        StdCommand::new("git").args(["checkout","feature"]).current_dir(p).output().unwrap();
        let files = get_changed_files(p, "main").unwrap();
        let paths: std::collections::HashSet<_> = files.iter().map(|f| f.path.as_str()).collect();

        assert!(paths.contains("feat.txt"));
        assert!(!paths.contains("only_main.txt"), "should not include changes that exist only on parent branch");
    }
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
