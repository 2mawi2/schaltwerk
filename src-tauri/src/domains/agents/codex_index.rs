use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{LazyLock, OnceLock, RwLock};

use super::extract_session_cwds;

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
struct SnapshotSignature {
    root_millis: Option<u128>,
    latest_dir_millis: Option<u128>,
    dir_count: u64,
}

impl SnapshotSignature {
    fn compute(sessions_dir: &Path) -> std::io::Result<Self> {
        if !sessions_dir.exists() {
            return Ok(Self::default());
        }

        let root_millis = fs::metadata(sessions_dir)
            .ok()
            .and_then(|meta| meta.modified().ok())
            .and_then(|ts| ts.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
            .map(|dur| dur.as_millis());

        let mut latest_dir_millis: Option<u128> = None;
        let mut dir_count: u64 = 0;
        let mut stack: Vec<(PathBuf, usize)> = vec![(sessions_dir.to_path_buf(), 0)];

        while let Some((dir, depth)) = stack.pop() {
            if depth > 3 {
                continue;
            }
            let read_dir = match fs::read_dir(&dir) {
                Ok(rd) => rd,
                Err(_) => continue,
            };
            for entry in read_dir.flatten() {
                let path = entry.path();
                if path.is_dir() {
                    dir_count += 1;
                    if let Ok(meta) = entry.metadata() {
                        if let Ok(modified) = meta.modified() {
                            if let Ok(millis) = modified
                                .duration_since(std::time::SystemTime::UNIX_EPOCH)
                                .map(|dur| dur.as_millis())
                            {
                                if latest_dir_millis
                                    .map(|current| millis > current)
                                    .unwrap_or(true)
                                {
                                    latest_dir_millis = Some(millis);
                                }
                            }
                        }
                    }
                    if depth < 3 {
                        stack.push((path, depth + 1));
                    }
                }
            }
        }

        Ok(Self {
            root_millis,
            latest_dir_millis,
            dir_count,
        })
    }
}

#[derive(Clone, Default)]
struct SessionFileInfo {
    path: PathBuf,
    modified_millis: Option<u128>,
}

#[derive(Clone, Default)]
struct Snapshot {
    per_cwd: HashMap<String, Vec<SessionFileInfo>>,
    global_newest: Option<PathBuf>,
}

#[derive(Default)]
struct IndexState {
    snapshot: Option<Snapshot>,
    signature: Option<SnapshotSignature>,
}

struct CodexSessionIndex {
    state: RwLock<IndexState>,
}

impl CodexSessionIndex {
    fn new() -> Self {
        Self {
            state: RwLock::new(IndexState::default()),
        }
    }

    fn ensure_snapshot(&self, sessions_dir: &Path) -> std::io::Result<()> {
        if !sessions_dir.exists() {
            let mut state = self.state.write().unwrap();
            state.snapshot = None;
            state.signature = None;
            return Ok(());
        }

        let current_signature = SnapshotSignature::compute(sessions_dir)?;

        {
            let state = self.state.read().unwrap();
            if state.signature.as_ref() == Some(&current_signature) && state.snapshot.is_some() {
                return Ok(());
            }
        }

        let (snapshot, signature) = build_snapshot(sessions_dir)?;
        let mut state = self.state.write().unwrap();
        state.snapshot = Some(snapshot);
        state.signature = Some(signature);
        Ok(())
    }

    fn match_for_cwd(
        &self,
        sessions_dir: &Path,
        target_cwd: &str,
    ) -> std::io::Result<Option<MatchResult>> {
        self.ensure_snapshot(sessions_dir)?;

        let state = self.state.read().unwrap();
        let snapshot = match &state.snapshot {
            Some(snapshot) => snapshot,
            None => return Ok(None),
        };

        if let Some(entries) = snapshot.per_cwd.get(target_cwd) {
            if let Some(info) = entries.first() {
                let is_global_newest = snapshot
                    .global_newest
                    .as_ref()
                    .map(|p| p == &info.path)
                    .unwrap_or(false);
                return Ok(Some(MatchResult {
                    resume_path: info.path.clone(),
                    is_global_newest,
                }));
            }
        }

        Ok(None)
    }

    fn invalidate(&self) {
        let mut state = self.state.write().unwrap();
        state.snapshot = None;
        state.signature = None;
    }
}

#[derive(Clone)]
pub(crate) struct MatchResult {
    pub(crate) resume_path: PathBuf,
    pub(crate) is_global_newest: bool,
}

static CODEX_SESSION_INDEX: LazyLock<CodexSessionIndex> = LazyLock::new(CodexSessionIndex::new);
static PREWARM_ONCE: OnceLock<()> = OnceLock::new();

pub(crate) fn match_for_cwd(
    sessions_dir: &Path,
    target_cwd: &str,
) -> std::io::Result<Option<MatchResult>> {
    CODEX_SESSION_INDEX.match_for_cwd(sessions_dir, target_cwd)
}

pub(crate) fn prewarm() {
    if PREWARM_ONCE.set(()).is_err() {
        return;
    }

    std::thread::spawn(|| {
        if let Some(home) = std::env::var("HOME")
            .ok()
            .map(PathBuf::from)
            .or_else(dirs::home_dir)
        {
            let sessions_dir = home.join(".codex").join("sessions");
            let _ = CODEX_SESSION_INDEX.ensure_snapshot(&sessions_dir);
        }
    });
}

pub(crate) fn invalidate() {
    CODEX_SESSION_INDEX.invalidate();
}

#[cfg(test)]
pub(crate) fn reset_for_tests() {
    CODEX_SESSION_INDEX.invalidate();
}

fn build_snapshot(sessions_dir: &Path) -> std::io::Result<(Snapshot, SnapshotSignature)> {
    if !sessions_dir.exists() {
        return Ok((Snapshot::default(), SnapshotSignature::default()));
    }

    let root_millis = fs::metadata(sessions_dir)
        .ok()
        .and_then(|meta| meta.modified().ok())
        .and_then(|ts| ts.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
        .map(|dur| dur.as_millis());

    let mut per_cwd: HashMap<String, Vec<SessionFileInfo>> = HashMap::new();
    let mut newest_file_path: Option<PathBuf> = None;
    let mut newest_file_millis: Option<u128> = None;
    let mut latest_dir_millis: Option<u128> = None;
    let mut dir_count: u64 = 0;

    let mut stack: Vec<(PathBuf, usize)> = vec![(sessions_dir.to_path_buf(), 0)];

    while let Some((dir, depth)) = stack.pop() {
        if depth > 3 {
            continue;
        }
        let read_dir = match fs::read_dir(&dir) {
            Ok(rd) => rd,
            Err(_) => continue,
        };
        for entry in read_dir.flatten() {
            let path = entry.path();
            if path.is_dir() {
                dir_count += 1;
                if let Ok(meta) = entry.metadata() {
                    if let Ok(modified) = meta.modified() {
                        if let Ok(millis) = modified
                            .duration_since(std::time::SystemTime::UNIX_EPOCH)
                            .map(|dur| dur.as_millis())
                        {
                            if latest_dir_millis.map(|current| millis > current).unwrap_or(true) {
                                latest_dir_millis = Some(millis);
                            }
                        }
                    }
                }
                if depth < 3 {
                    stack.push((path, depth + 1));
                }
                continue;
            }

            if path.extension().is_none_or(|ext| ext != "jsonl") {
                continue;
            }

            let modified_millis = path
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|ts| ts.duration_since(std::time::SystemTime::UNIX_EPOCH).ok())
                .map(|dur| dur.as_millis());

            if let Some(millis) = modified_millis {
                if newest_file_millis
                    .map(|current| millis > current)
                    .unwrap_or(true)
                {
                    newest_file_millis = Some(millis);
                    newest_file_path = Some(path.clone());
                }
            }

            for cwd in extract_session_cwds(&path) {
                per_cwd
                    .entry(cwd)
                    .or_default()
                    .push(SessionFileInfo {
                        path: path.clone(),
                        modified_millis,
                    });
            }
        }
    }

    for entries in per_cwd.values_mut() {
        entries.sort_by(|a, b| match (b.modified_millis, a.modified_millis) {
            (Some(bm), Some(am)) => bm.cmp(&am),
            (Some(_), None) => std::cmp::Ordering::Less,
            (None, Some(_)) => std::cmp::Ordering::Greater,
            (None, None) => b.path.cmp(&a.path),
        });
    }

    let snapshot = Snapshot {
        per_cwd,
        global_newest: newest_file_path,
    };

    let signature = SnapshotSignature {
        root_millis,
        latest_dir_millis,
        dir_count,
    };

    Ok((snapshot, signature))
}
