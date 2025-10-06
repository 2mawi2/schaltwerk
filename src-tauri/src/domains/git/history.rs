use anyhow::{Context, Result};
use git2::{Oid, Repository};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::path::Path;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItemRef {
    pub id: String,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub revision: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub icon: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryItem {
    pub id: String,
    #[serde(rename = "parentIds")]
    pub parent_ids: Vec<String>,
    pub subject: String,
    pub author: String,
    pub timestamp: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub references: Option<Vec<HistoryItemRef>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub summary: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "fullHash")]
    pub full_hash: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct HistoryProviderSnapshot {
    pub items: Vec<HistoryItem>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "currentRef")]
    pub current_ref: Option<HistoryItemRef>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "currentRemoteRef")]
    pub current_remote_ref: Option<HistoryItemRef>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "currentBaseRef")]
    pub current_base_ref: Option<HistoryItemRef>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "nextCursor")]
    pub next_cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none", rename = "hasMore")]
    pub has_more: Option<bool>,
}

const DEFAULT_HISTORY_LIMIT: usize = 400;

pub fn get_git_history(
    repo_path: &Path,
    limit: Option<usize>,
    cursor: Option<&str>,
) -> Result<HistoryProviderSnapshot> {
    let repo = Repository::open(repo_path).context("Failed to open git repository")?;

    let mut items = Vec::new();
    let mut oid_to_refs: HashMap<Oid, Vec<HistoryItemRef>> = HashMap::new();
    let mut walk_roots = Vec::new();

    let references = repo.references()?;
    for reference in references {
        let reference = reference?;
        if let Some(name) = reference.name() {
            if let Ok(resolved) = reference.resolve() {
                if let Some(target) = resolved.target() {
                    let ref_type = if name.starts_with("refs/heads/") {
                        walk_roots.push(target);
                        Some("branch")
                    } else if name.starts_with("refs/remotes/") {
                        Some("remote")
                    } else if name.starts_with("refs/tags/") {
                        Some("tag")
                    } else {
                        None
                    };

                    if let Some(icon) = ref_type {
                        let short_name = name
                            .strip_prefix("refs/heads/")
                            .or_else(|| name.strip_prefix("refs/remotes/"))
                            .or_else(|| name.strip_prefix("refs/tags/"))
                            .unwrap_or(name);

                        let history_ref = HistoryItemRef {
                            id: name.to_string(),
                            name: short_name.to_string(),
                            revision: Some(target.to_string()),
                            color: None,
                            icon: Some(icon.to_string()),
                        };

                        oid_to_refs.entry(target).or_default().push(history_ref);
                    }
                }
            }
        }
    }

    let mut revwalk = repo.revwalk()?;
    revwalk.set_sorting(git2::Sort::TOPOLOGICAL | git2::Sort::TIME)?;

    let mut seen_roots = HashSet::new();
    for ref_oid in walk_roots {
        if seen_roots.insert(ref_oid) {
            revwalk.push(ref_oid)?;
        }
    }

    if seen_roots.is_empty() {
        if let Ok(head) = repo.head() {
            if let Some(target) = head.target() {
                revwalk.push(target)?;
            }
        }
    }

    let effective_limit = limit
        .filter(|value| *value > 0)
        .unwrap_or(DEFAULT_HISTORY_LIMIT);
    let cursor_value = cursor.map(|c| c.to_owned());
    let mut cursor_seen = cursor_value.is_none();
    let mut visited = HashSet::new();
    let mut last_full_oid = None;
    let mut has_more = false;

    for oid_result in revwalk {
        if items.len() >= effective_limit {
            has_more = true;
            break;
        }

        let oid = oid_result?;

        if !visited.insert(oid) {
            continue;
        }

        let full_oid = oid.to_string();

        if !cursor_seen {
            if let Some(ref target) = cursor_value {
                if &full_oid == target {
                    cursor_seen = true;
                }
                continue;
            }
        }

        let commit = repo.find_commit(oid)?;
        let parent_ids: Vec<String> = commit
            .parent_ids()
            .map(|id| id.to_string()[..7].to_string())
            .collect();

        let history_item = HistoryItem {
            id: full_oid[..7].to_string(),
            parent_ids,
            subject: commit.summary().unwrap_or("(no message)").to_string(),
            author: commit.author().name().unwrap_or("Unknown").to_string(),
            timestamp: commit.time().seconds() * 1000,
            references: oid_to_refs.get(&oid).cloned(),
            summary: None,
            full_hash: Some(full_oid.clone()),
        };

        last_full_oid = Some(full_oid);
        items.push(history_item);
    }

    if cursor_value.is_some() && !cursor_seen {
        return get_git_history(repo_path, Some(effective_limit), None);
    }

    let current_ref = repo.head().ok().and_then(|head| {
        let name = head.name()?;
        let short_name = name.strip_prefix("refs/heads/").unwrap_or(name);
        let target = head.target().map(|oid| oid.to_string()[..7].to_string());

        Some(HistoryItemRef {
            id: name.to_string(),
            name: short_name.to_string(),
            revision: target,
            color: None,
            icon: Some("branch".to_string()),
        })
    });

    let current_remote_ref = current_ref.as_ref().and_then(|current| {
        let remote_name = format!("refs/remotes/origin/{}", current.name);
        repo.find_reference(&remote_name)
            .ok()
            .and_then(|r| r.target())
            .map(|oid| HistoryItemRef {
                id: remote_name.clone(),
                name: format!("origin/{}", current.name),
                revision: Some(oid.to_string()[..7].to_string()),
                color: None,
                icon: Some("remote".to_string()),
            })
    });

    Ok(HistoryProviderSnapshot {
        items,
        current_ref,
        current_remote_ref,
        current_base_ref: None,
        next_cursor: last_full_oid,
        has_more: Some(has_more),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Oid, Repository, Signature};
    use tempfile::TempDir;

    fn init_repo() -> Result<(TempDir, Repository)> {
        let dir = TempDir::new().context("failed to create tempdir")?;
        let repo = Repository::init(dir.path()).context("failed to init repo")?;
        Ok((dir, repo))
    }

    fn write_file(repo: &Repository, idx: usize) -> Result<()> {
        let path = repo
            .workdir()
            .context("missing workdir")?
            .join(format!("file_{idx}.txt"));
        std::fs::write(&path, format!("content {idx}")).context("failed to write file")?;
        Ok(())
    }

    fn create_commit<'repo>(
        repo: &'repo Repository,
        message: &str,
        parent: Option<&git2::Commit<'repo>>,
    ) -> Result<git2::Commit<'repo>> {
        let mut index = repo.index().context("failed to access index")?;
        index
            .add_all(["*"].iter(), git2::IndexAddOption::DEFAULT, None)
            .context("failed to add to index")?;
        index.write().context("failed to write index")?;
        let tree_id = index.write_tree().context("failed to write tree")?;
        let tree = repo.find_tree(tree_id).context("failed to find tree")?;
        let sig =
            Signature::now("Tester", "tester@example.com").context("failed to create signature")?;
        let parents: Vec<&git2::Commit<'repo>> = parent.into_iter().collect();
        let commit_id = repo
            .commit(Some("HEAD"), &sig, &sig, message, &tree, &parents)
            .context("failed to create commit")?;
        repo.find_commit(commit_id)
            .context("failed to retrieve commit")
    }

    fn seed_linear_history(count: usize) -> Result<(TempDir, Repository, Vec<String>)> {
        let (dir, repo) = init_repo()?;

        let mut parent_oid: Option<Oid> = None;
        let mut created = Vec::new();

        for idx in 0..count {
            write_file(&repo, idx)?;
            let parent_commit = match parent_oid {
                Some(oid) => Some(repo.find_commit(oid).context("missing parent commit")?),
                None => None,
            };
            let commit = create_commit(&repo, &format!("commit-{idx}"), parent_commit.as_ref())?;
            parent_oid = Some(commit.id());
            created.push(commit.id().to_string());
        }

        Ok((dir, repo, created))
    }

    #[test]
    fn limits_initial_history_page_and_sets_has_more() {
        let (_dir, repo, commits) = seed_linear_history(6).expect("seed repo");

        let snapshot = get_git_history(repo.workdir().unwrap(), Some(3), None).expect("history");

        assert_eq!(snapshot.items.len(), 3, "expected first page to be limited");
        assert_eq!(snapshot.has_more, Some(true));
        assert!(snapshot.next_cursor.is_some());

        for item in snapshot.items {
            assert!(item.full_hash.is_some(), "expected full hash populated");
        }

        let latest_commit_id = commits.last().expect("commits");
        assert_ne!(snapshot.next_cursor.unwrap(), *latest_commit_id);
    }

    #[test]
    fn resumes_after_cursor() {
        let (_dir, repo, _commits) = seed_linear_history(5).expect("seed repo");
        let first_page =
            get_git_history(repo.workdir().unwrap(), Some(2), None).expect("first page");
        let cursor = first_page.next_cursor.clone().expect("cursor");

        let second_page =
            get_git_history(repo.workdir().unwrap(), Some(2), Some(&cursor)).expect("second page");

        assert_eq!(second_page.items.len(), 2);
        assert!(second_page.items[0].id != first_page.items[0].id);
    }
}
