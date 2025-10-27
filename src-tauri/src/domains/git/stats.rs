use crate::binary_detection::is_binary_file_by_extension;
use crate::domains::sessions::entity::{ChangedFile, GitStats};
use anyhow::Result;
use chrono::Utc;
use git2::{Diff, DiffFindOptions, DiffFormat, DiffOptions, Oid, Repository, StatusOptions};
use std::collections::{HashMap, HashSet, hash_map::Entry};
use std::fs;
use std::path::Path;
#[cfg(test)]
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Mutex, OnceLock};

const LARGE_SESSION_THRESHOLD: usize = 500;
const VERY_LARGE_SESSION_THRESHOLD: usize = 2000;

#[cfg(test)]
static GIT_STATS_CALL_COUNT: OnceLock<AtomicUsize> = OnceLock::new();

#[cfg(test)]
static GIT_STATS_THREAD_FILTER: OnceLock<Mutex<Option<std::thread::ThreadId>>> = OnceLock::new();

#[cfg(test)]
static GIT_STATS_CACHE_HITS: OnceLock<AtomicUsize> = OnceLock::new();

#[cfg(test)]
fn increment_git_stats_call_count() {
    let filter = GIT_STATS_THREAD_FILTER.get_or_init(|| Mutex::new(None));
    if let Some(target_thread) = *filter.lock().unwrap() {
        if std::thread::current().id() != target_thread {
            return;
        }
    }

    GIT_STATS_CALL_COUNT
        .get_or_init(|| AtomicUsize::new(0))
        .fetch_add(1, Ordering::Relaxed);
}

#[cfg(test)]
fn increment_git_stats_cache_hits() {
    let filter = GIT_STATS_THREAD_FILTER.get_or_init(|| Mutex::new(None));
    if let Some(target_thread) = *filter.lock().unwrap() {
        if std::thread::current().id() != target_thread {
            return;
        }
    }

    GIT_STATS_CACHE_HITS
        .get_or_init(|| AtomicUsize::new(0))
        .fetch_add(1, Ordering::Relaxed);
}

#[cfg(test)]
pub fn reset_git_stats_call_count() {
    if let Some(counter) = GIT_STATS_CALL_COUNT.get() {
        counter.store(0, Ordering::Relaxed);
    }
}

#[cfg(test)]
pub fn reset_git_stats_cache_hits() {
    if let Some(counter) = GIT_STATS_CACHE_HITS.get() {
        counter.store(0, Ordering::Relaxed);
    }
}

#[derive(Default, Debug, Clone, Copy)]
struct FileDiffStat {
    additions: u32,
    deletions: u32,
    is_binary: bool,
}

pub fn build_changed_files_from_diff(diff: &Diff) -> Result<Vec<ChangedFile>> {
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut index_map: HashMap<String, usize> = HashMap::new();
    let mut stats_map: HashMap<String, FileDiffStat> = HashMap::new();

    for delta in diff.deltas() {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str());

        let Some(path_str) = path else { continue };
        if path_str.starts_with(".schaltwerk/") || path_str == ".schaltwerk" {
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

        let is_binary = delta.new_file().is_binary() || delta.old_file().is_binary();

        let entry_index = match index_map.entry(path_str.to_string()) {
            Entry::Occupied(existing) => *existing.get(),
            Entry::Vacant(vacant) => {
                let idx = files.len();
                vacant.insert(idx);
                files.push(ChangedFile::new(
                    path_str.to_string(),
                    change_type.to_string(),
                ));
                idx
            }
        };

        if is_binary {
            files[entry_index].is_binary = Some(true);
        }

        let stat_entry = stats_map.entry(path_str.to_string()).or_default();
        if is_binary {
            stat_entry.is_binary = true;
        }
    }

    diff.print(DiffFormat::Patch, |delta, _hunk, line| {
        let path = delta
            .new_file()
            .path()
            .or_else(|| delta.old_file().path())
            .and_then(|p| p.to_str());

        if let Some(path_str) = path {
            if path_str.starts_with(".schaltwerk/") || path_str == ".schaltwerk" {
                return true;
            }

            let entry = stats_map.entry(path_str.to_string()).or_default();
            match line.origin() {
                '+' => entry.additions += 1,
                '-' => entry.deletions += 1,
                _ => {}
            }
        }

        true
    })?;

    for file in &mut files {
        if let Some(stat) = stats_map.get(&file.path) {
            file.additions = stat.additions;
            file.deletions = stat.deletions;
            file.changes = stat.additions + stat.deletions;
            if stat.is_binary {
                file.is_binary = Some(true);
            }
        } else {
            file.changes = file.additions + file.deletions;
        }

        if file.is_binary.is_none() && file.changes == 0 && is_binary_file_by_extension(&file.path)
        {
            file.is_binary = Some(true);
        }
    }

    files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(files)
}

#[cfg(test)]
pub fn get_git_stats_call_count() -> usize {
    GIT_STATS_CALL_COUNT
        .get_or_init(|| AtomicUsize::new(0))
        .load(Ordering::Relaxed)
}

#[cfg(test)]
pub fn get_git_stats_cache_hits() -> usize {
    GIT_STATS_CACHE_HITS
        .get_or_init(|| AtomicUsize::new(0))
        .load(Ordering::Relaxed)
}

#[cfg(test)]
pub struct GitStatsThreadScope;

#[cfg(test)]
impl Drop for GitStatsThreadScope {
    fn drop(&mut self) {
        if let Some(filter) = GIT_STATS_THREAD_FILTER.get() {
            *filter.lock().unwrap() = None;
        }
    }
}

#[cfg(test)]
pub fn track_git_stats_on_current_thread() -> GitStatsThreadScope {
    let filter = GIT_STATS_THREAD_FILTER.get_or_init(|| Mutex::new(None));
    *filter.lock().unwrap() = Some(std::thread::current().id());
    GitStatsThreadScope
}

#[derive(Clone, Debug, PartialEq, Eq, Hash)]
struct StatsCacheKey {
    head: Option<Oid>,
    index_signature: Option<u64>,
    status_signature: u64,
}

type StatsCacheMap = HashMap<(std::path::PathBuf, String), (StatsCacheKey, GitStats)>;
/// Process-wide memoization of the most recent stats per (worktree, parent branch).
///
/// The mutex protects concurrent refreshes within a single Schaltwerk process. The key
/// includes the absolute worktree path, so concurrent projects do not collide.
/// This keeps the cache safe even when multiple projects are active.
static STATS_CACHE: OnceLock<Mutex<StatsCacheMap>> = OnceLock::new();

#[cfg(test)]
pub fn clear_stats_cache() {
    if let Some(cache) = STATS_CACHE.get() {
        cache.lock().unwrap().clear();
    }
}

#[inline]
fn is_internal_tooling_path(path: &str) -> bool {
    path == ".schaltwerk" || path.starts_with(".schaltwerk/")
}

pub fn calculate_git_stats_fast(worktree_path: &Path, parent_branch: &str) -> Result<GitStats> {
    #[cfg(test)]
    increment_git_stats_call_count();

    let start_time = std::time::Instant::now();
    // IMPORTANT: Open the worktree repo directly. Using `discover` may return
    // the parent repository and yield incorrect status for worktrees.
    let repo = Repository::open(worktree_path)?;
    let repo_discover_time = start_time.elapsed();

    let head_oid = repo.head().ok().and_then(|h| h.target());
    let head_commit = head_oid.and_then(|oid| repo.find_commit(oid).ok());
    let head_tree = head_commit.as_ref().and_then(|c| c.tree().ok());

    let base_ref = repo.revparse_single(parent_branch).ok();
    let base_commit = base_ref.and_then(|obj| obj.peel_to_commit().ok());
    // Use merge-base between HEAD and parent_branch to represent the baseline
    let base_tree = match (base_commit.as_ref(), head_commit.as_ref()) {
        (Some(base_c), Some(head_c)) => {
            if let Ok(merge_base_oid) = repo.merge_base(base_c.id(), head_c.id()) {
                repo.find_commit(merge_base_oid)
                    .ok()
                    .and_then(|c| c.tree().ok())
            } else {
                None
            }
        }
        _ => None,
    };

    let mut status_opts = StatusOptions::new();
    status_opts
        .include_untracked(true)
        .recurse_untracked_dirs(true);
    let statuses = repo.statuses(Some(&mut status_opts))?;
    // Compute filtered has_uncommitted: ignore .schaltwerk internal files
    let has_uncommitted_filtered = statuses.iter().any(|entry| {
        if let Some(path) = entry.path()
            && is_internal_tooling_path(path)
        {
            return false;
        }
        true
    }) && !statuses.is_empty();
    // Sample a few offending paths for diagnostics
    let mut sample: Vec<String> = Vec::new();
    for entry in statuses.iter() {
        if let Some(path) = entry.path()
            && is_internal_tooling_path(path)
        {
            continue;
        }
        if let Some(path) = entry.path() {
            sample.push(path.to_string());
            if sample.len() >= 5 {
                break;
            }
        }
    }
    log::debug!(
        "git_stats: begin path={} parent={} status_total={} has_uncommitted={} sample={:?}",
        worktree_path.display(),
        parent_branch,
        statuses.len(),
        has_uncommitted_filtered,
        sample
    );
    let mut status_sig: u64 = 1469598103934665603;
    for entry in statuses.iter() {
        let s = entry.status().bits() as u64;
        status_sig ^= s.wrapping_mul(1099511628211);
        if let Some(path) = entry.path() {
            for b in path.as_bytes() {
                status_sig ^= (*b as u64).wrapping_mul(1099511628211);
            }
        }
    }

    let index_signature = repo.index().ok().map(|idx| {
        let mut sig: u64 = 1469598103934665603;
        for entry in idx.iter() {
            for b in entry.path.iter() {
                sig ^= (*b as u64).wrapping_mul(1099511628211);
            }
            let id = entry.id;
            for b in id.as_bytes() {
                sig ^= (*b as u64).wrapping_mul(1099511628211);
            }
        }
        sig
    });

    let key = StatsCacheKey {
        head: head_oid,
        index_signature,
        status_signature: status_sig,
    };
    let cache_key = (worktree_path.to_path_buf(), parent_branch.to_string());
    if let Some(m) = STATS_CACHE.get()
        && let Some((k, v)) = m.lock().unwrap().get(&cache_key)
        && *k == key
    {
        let cache_hit_time = start_time.elapsed();
        #[cfg(test)]
        increment_git_stats_cache_hits();
        log::debug!(
            "Git stats cache hit for {} ({}ms)",
            worktree_path.display(),
            cache_hit_time.as_millis()
        );
        let mut last_diff_change_ts: Option<i64> = None;
        if let (Some(base_commit), Some(head_commit)) = (base_commit.as_ref(), head_commit.as_ref())
            && let Ok(merge_base_oid) = repo.merge_base(base_commit.id(), head_commit.id())
            && repo.revparse(&format!("{merge_base_oid}..HEAD")).is_ok()
            && let Ok(mut revwalk) = repo.revwalk()
        {
            revwalk.push_head().ok();
            revwalk.hide(merge_base_oid).ok();
            let latest_commit_ts = revwalk
                .filter_map(|oid| oid.ok())
                .filter_map(|oid| repo.find_commit(oid).ok())
                .map(|c| c.time().seconds())
                .max();
            if let Some(ts) = latest_commit_ts {
                last_diff_change_ts = Some(ts);
            }
        }

        let mut files_for_mtime: HashSet<String> = HashSet::new();
        if let Some(ht) = head_tree.as_ref()
            && let Ok(idx) = repo.index()
        {
            let mut staged_opts = DiffOptions::new();
            if let Ok(diff_for_mtime) =
                repo.diff_tree_to_index(Some(ht), Some(&idx), Some(&mut staged_opts))
            {
                for d in diff_for_mtime.deltas() {
                    if let Some(p) = d.new_file().path().or_else(|| d.old_file().path())
                        && let Some(s) = p.to_str()
                    {
                        files_for_mtime.insert(s.to_string());
                    }
                }
            }
        }
        if let Ok(idx) = repo.index() {
            let mut workdir_opts = DiffOptions::new();
            workdir_opts
                .include_untracked(true)
                .recurse_untracked_dirs(true);
            if let Ok(diff_for_mtime) =
                repo.diff_index_to_workdir(Some(&idx), Some(&mut workdir_opts))
            {
                for d in diff_for_mtime.deltas() {
                    if let Some(p) = d.new_file().path().or_else(|| d.old_file().path())
                        && let Some(s) = p.to_str()
                    {
                        files_for_mtime.insert(s.to_string());
                    }
                }
            }
        }
        let mut latest_uncommitted_ts: Option<i64> = None;
        let mut saw_schema_change_cache: bool = false;
        for rel in files_for_mtime {
            let abs = worktree_path.join(&rel);
            if let Ok(metadata) = fs::metadata(&abs)
                && let Ok(modified) = metadata.modified()
                && let Ok(secs) = modified.duration_since(std::time::UNIX_EPOCH)
            {
                let ts = secs.as_secs() as i64;
                latest_uncommitted_ts = Some(latest_uncommitted_ts.map_or(ts, |cur| cur.max(ts)));
            } else {
                saw_schema_change_cache = true;
            }
        }
        if let Some(u_ts) = latest_uncommitted_ts {
            last_diff_change_ts = Some(match last_diff_change_ts {
                Some(c_ts) => c_ts.max(u_ts),
                None => u_ts,
            });
        }
        if last_diff_change_ts.is_none() && saw_schema_change_cache {
            last_diff_change_ts = Some(Utc::now().timestamp());
        }

        let total_cache_time = start_time.elapsed();
        if total_cache_time.as_millis() > 50 {
            log::debug!(
                "Git stats cache hit processing took {}ms for {}",
                total_cache_time.as_millis(),
                worktree_path.display()
            );
        }
        log::debug!(
            "git_stats: cache_hit path={} has_uncommitted={}",
            worktree_path.display(),
            has_uncommitted_filtered
        );
        return Ok(GitStats {
            session_id: v.session_id.clone(),
            files_changed: v.files_changed,
            lines_added: v.lines_added,
            lines_removed: v.lines_removed,
            has_uncommitted: has_uncommitted_filtered,
            calculated_at: Utc::now(),
            last_diff_change_ts,
        });
    }

    let mut files: HashSet<String> = HashSet::new();
    let mut files_for_mtime: HashSet<String> = HashSet::new();
    let mut insertions: u32 = 0;
    let mut deletions: u32 = 0;
    let mut saw_schema_change: bool = false;

    let mut opts = DiffOptions::new();
    opts.include_untracked(true).recurse_untracked_dirs(true);

    if let Some(ref bt) = base_tree
        && let Ok(mut diff) = repo.diff_tree_to_workdir_with_index(Some(bt), Some(&mut opts))
    {
        let mut find_opts = DiffFindOptions::new();
        diff.find_similar(Some(&mut find_opts)).ok();
        for delta in diff.deltas() {
            if let Some(path) = delta.new_file().path().or_else(|| delta.old_file().path())
                && let Some(path_str) = path.to_str()
            {
                files.insert(path_str.to_string());
                files_for_mtime.insert(path_str.to_string());
            }

            if files.len() >= VERY_LARGE_SESSION_THRESHOLD {
                log::info!(
                    "Session has {} files (>= {VERY_LARGE_SESSION_THRESHOLD}), skipping stats calculation",
                    files.len()
                );
                return Err(anyhow::anyhow!(
                    "Session too large ({} files) for stats calculation",
                    files.len()
                ));
            }

            use git2::Delta;
            match delta.status() {
                Delta::Deleted | Delta::Renamed | Delta::Typechange => {
                    saw_schema_change = true;
                }
                _ => {}
            }
        }

        if files.len() >= LARGE_SESSION_THRESHOLD {
            log::info!(
                "Session has {} files (>= {LARGE_SESSION_THRESHOLD}), stats calculation may be slow",
                files.len()
            );
        }

        if let Ok(stats) = diff.stats() {
            insertions = stats.insertions() as u32;
            deletions = stats.deletions() as u32;
        }
    }

    // Compute diff-aware last change timestamp
    let mut last_diff_change_ts: Option<i64> = None;

    // Latest committed change ahead of parent_branch (relative to merge-base)
    if let (Some(base_commit), Some(head_commit)) = (base_commit.as_ref(), head_commit.as_ref())
        && let Ok(merge_base_oid) = repo.merge_base(base_commit.id(), head_commit.id())
        && repo.revparse(&format!("{merge_base_oid}..HEAD")).is_ok()
    {
        // Iterate commits in the range and take the most recent commit time (should be HEAD's time)
        if let Ok(mut revwalk) = repo.revwalk() {
            revwalk.push_head().ok();
            revwalk.hide(merge_base_oid).ok();
            let latest_commit_ts = revwalk
                .filter_map(|oid| oid.ok())
                .filter_map(|oid| repo.find_commit(oid).ok())
                .map(|c| c.time().seconds())
                .max();
            if let Some(ts) = latest_commit_ts {
                last_diff_change_ts = Some(ts);
            }
        }
    }

    // Latest mtime among changed-but-uncommitted files (staged, unstaged, untracked)
    let mut latest_uncommitted_ts: Option<i64> = None;
    for rel in files_for_mtime {
        let abs = worktree_path.join(&rel);
        if let Ok(metadata) = fs::metadata(&abs)
            && let Ok(modified) = metadata.modified()
            && let Ok(secs) = modified.duration_since(std::time::UNIX_EPOCH)
        {
            let ts = secs.as_secs() as i64;
            latest_uncommitted_ts = Some(latest_uncommitted_ts.map_or(ts, |cur| cur.max(ts)));
        }
    }
    if let Some(u_ts) = latest_uncommitted_ts {
        last_diff_change_ts = Some(match last_diff_change_ts {
            Some(c_ts) => c_ts.max(u_ts),
            None => u_ts,
        });
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
        has_uncommitted: has_uncommitted_filtered,
        calculated_at: Utc::now(),
        last_diff_change_ts,
    };

    let map = STATS_CACHE.get_or_init(|| Mutex::new(HashMap::new()));
    map.lock().unwrap().insert(cache_key, (key, stats.clone()));

    let total_time = start_time.elapsed();
    if total_time.as_millis() > 100 {
        log::warn!(
            "Git stats calculation took {}ms for {} (repo_discover: {}ms, insertions: {}, deletions: {})",
            total_time.as_millis(),
            worktree_path.display(),
            repo_discover_time.as_millis(),
            insertions,
            deletions
        );
    } else if total_time.as_millis() > 50 {
        log::debug!(
            "Git stats calculation took {}ms for {}",
            total_time.as_millis(),
            worktree_path.display()
        );
    }

    log::debug!(
        "git_stats: end path={} files_changed={} +{} -{} has_uncommitted={} elapsed_ms={}",
        worktree_path.display(),
        stats.files_changed,
        stats.lines_added,
        stats.lines_removed,
        stats.has_uncommitted,
        total_time.as_millis()
    );
    Ok(stats)
}

pub fn get_changed_files(worktree_path: &Path, parent_branch: &str) -> Result<Vec<ChangedFile>> {
    // Show all changes introduced by this worktree: committed + uncommitted
    // Baseline = merge-base(HEAD, parent_branch); Target = workdir with index
    // Use `open` to ensure we operate on the specific worktree, not the parent repo.
    let repo = Repository::open(worktree_path)?;

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

    if let Some(base_tree) = baseline_tree {
        let mut opts = DiffOptions::new();
        opts.include_untracked(true)
            .recurse_untracked_dirs(true)
            .show_untracked_content(true)
            .show_binary(true)
            .ignore_submodules(true);

        let mut diff = repo.diff_tree_to_workdir_with_index(Some(&base_tree), Some(&mut opts))?;
        let mut find_opts = DiffFindOptions::new();
        diff.find_similar(Some(&mut find_opts))?;
        build_changed_files_from_diff(&diff)
    } else {
        Ok(Vec::new())
    }
}

#[cfg(test)]
pub fn parse_numstat_line(line: &str) -> Option<(u32, u32, &str)> {
    let parts: Vec<&str> = line.split('\t').collect();
    if parts.len() != 3 {
        return None;
    }

    let additions = if parts[0] == "-" {
        0
    } else {
        parts[0].parse().ok()?
    };
    let deletions = if parts[1] == "-" {
        0
    } else {
        parts[1].parse().ok()?
    };
    let file_path = parts[2];

    Some((additions, deletions, file_path))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use std::process::Command as StdCommand;
    use tempfile::TempDir;

    fn init_repo() -> TempDir {
        clear_stats_cache();
        let temp = TempDir::new().unwrap();
        let p = temp.path();
        StdCommand::new("git")
            .args(["init"])
            .current_dir(p)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.name", "Test"])
            .current_dir(p)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["config", "user.email", "t@example.com"])
            .current_dir(p)
            .output()
            .unwrap();
        fs::write(p.join("README.md"), "root\n").unwrap();
        StdCommand::new("git")
            .args(["add", "."])
            .current_dir(p)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "init"])
            .current_dir(p)
            .output()
            .unwrap();
        // Rename default branch to main for consistency
        let cur = StdCommand::new("git")
            .args(["rev-parse", "--abbrev-ref", "HEAD"])
            .current_dir(p)
            .output()
            .unwrap();
        let cur_name = String::from_utf8_lossy(&cur.stdout).trim().to_string();
        if cur_name != "main" && !cur_name.is_empty() {
            StdCommand::new("git")
                .args(["branch", "-m", &cur_name, "main"])
                .current_dir(p)
                .output()
                .unwrap();
        }
        temp
    }

    #[test]
    fn includes_committed_and_uncommitted_from_worktree() {
        let repo = init_repo();
        let p = repo.path();

        // Create feature branch
        StdCommand::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(p)
            .output()
            .unwrap();

        // Commit a file on feature
        fs::write(p.join("committed.txt"), "hello\n").unwrap();
        StdCommand::new("git")
            .args(["add", "committed.txt"])
            .current_dir(p)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "add committed"])
            .current_dir(p)
            .output()
            .unwrap();

        // Create uncommitted changes
        fs::write(p.join("untracked.txt"), "u\n").unwrap();
        fs::write(p.join("README.md"), "root-mod\n").unwrap();

        let files = get_changed_files(p, "main").unwrap();
        let paths: std::collections::HashSet<_> = files.iter().map(|f| f.path.as_str()).collect();

        assert!(
            paths.contains("committed.txt"),
            "should include committed change relative to main"
        );
        assert!(
            paths.contains("untracked.txt"),
            "should include untracked file"
        );
        assert!(
            paths.contains("README.md"),
            "should include modified working file"
        );
    }

    #[test]
    fn excludes_changes_only_on_parent() {
        let repo = init_repo();
        let p = repo.path();

        // Branch and make a feature commit
        StdCommand::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(p)
            .output()
            .unwrap();
        fs::write(p.join("feat.txt"), "f\n").unwrap();
        StdCommand::new("git")
            .args(["add", "feat.txt"])
            .current_dir(p)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "feat"])
            .current_dir(p)
            .output()
            .unwrap();

        // Simulate main moving ahead with an unrelated commit (not merged)
        StdCommand::new("git")
            .args(["checkout", "main"])
            .current_dir(p)
            .output()
            .unwrap();
        fs::write(p.join("only_main.txt"), "m\n").unwrap();
        StdCommand::new("git")
            .args(["add", "only_main.txt"])
            .current_dir(p)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "main ahead"])
            .current_dir(p)
            .output()
            .unwrap();

        // Back to feature, compute changes vs main using merge-base
        StdCommand::new("git")
            .args(["checkout", "feature"])
            .current_dir(p)
            .output()
            .unwrap();
        let files = get_changed_files(p, "main").unwrap();
        let paths: std::collections::HashSet<_> = files.iter().map(|f| f.path.as_str()).collect();

        assert!(paths.contains("feat.txt"));
        assert!(
            !paths.contains("only_main.txt"),
            "should not include changes that exist only on parent branch"
        );
    }

    #[test]
    fn changed_files_include_line_stats_and_binary_flag() {
        let repo = init_repo();
        let p = repo.path();

        // Add an extra file on main so we can later delete it in the feature branch
        fs::write(p.join("to_delete.txt"), "keep me\n").unwrap();
        StdCommand::new("git")
            .args(["add", "to_delete.txt"])
            .current_dir(p)
            .output()
            .unwrap();
        StdCommand::new("git")
            .args(["commit", "-m", "add deletable file"])
            .current_dir(p)
            .output()
            .unwrap();

        // Work on a feature branch
        StdCommand::new("git")
            .args(["checkout", "-b", "feature"])
            .current_dir(p)
            .output()
            .unwrap();

        // Modify README so we have both additions and deletions
        fs::write(p.join("README.md"), "feature\n").unwrap();

        // Create a new text file with two lines
        fs::write(p.join("new_file.txt"), "line1\nline2\n").unwrap();

        // Delete the file we added on main
        fs::remove_file(p.join("to_delete.txt")).unwrap();

        // Create a binary file containing null bytes
        let binary_content: Vec<u8> = (0u8..=255).collect();
        fs::write(p.join("binary.png"), &binary_content).unwrap();
        StdCommand::new("git")
            .args(["add", "binary.png"])
            .current_dir(p)
            .output()
            .unwrap();

        let changed = get_changed_files(p, "main").expect("changed files");
        let map: std::collections::HashMap<_, _> =
            changed.into_iter().map(|f| (f.path.clone(), f)).collect();

        let readme = map.get("README.md").expect("readme diff");
        assert_eq!(readme.change_type, "modified");
        assert_eq!(readme.additions, 1);
        assert_eq!(readme.deletions, 1);
        assert_eq!(readme.changes, 2);
        assert_eq!(readme.is_binary, None);

        let new_file = map.get("new_file.txt").expect("new file diff");
        assert_eq!(new_file.change_type, "added");
        assert_eq!(new_file.additions, 2);
        assert_eq!(new_file.deletions, 0);
        assert_eq!(new_file.changes, 2);

        let deleted = map.get("to_delete.txt").expect("deleted diff");
        assert_eq!(deleted.change_type, "deleted");
        assert_eq!(deleted.additions, 0);
        assert!(deleted.deletions >= 1);
        assert_eq!(deleted.changes, deleted.deletions);

        let binary = map.get("binary.png").expect("binary diff");
        assert_eq!(binary.change_type, "added");
        assert_eq!(binary.additions, 0);
        assert_eq!(binary.deletions, 0);
        assert_eq!(binary.changes, 0);
        assert_eq!(binary.is_binary, Some(true));
    }
}
