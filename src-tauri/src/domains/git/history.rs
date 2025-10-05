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
}

pub fn get_git_history(repo_path: &Path) -> Result<HistoryProviderSnapshot> {
    let repo = Repository::open(repo_path)
        .context("Failed to open git repository")?;

    let mut items = Vec::new();
    let mut oid_to_refs: HashMap<Oid, Vec<HistoryItemRef>> = HashMap::new();
    let mut visited = HashSet::new();
    let mut ref_heads = Vec::new();

    let references = repo.references()?;
    for reference in references {
        let reference = reference?;
        if let Some(name) = reference.name() {
            if let Ok(resolved) = reference.resolve() {
                if let Some(target) = resolved.target() {
                    let ref_type = if name.starts_with("refs/heads/") {
                        ref_heads.push(target);
                        Some("branch")
                    } else if name.starts_with("refs/remotes/") {
                        ref_heads.push(target);
                        Some("remote")
                    } else if name.starts_with("refs/tags/") {
                        ref_heads.push(target);
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

    for ref_oid in ref_heads {
        revwalk.push(ref_oid)?;
    }

    for oid_result in revwalk {
        let oid = oid_result?;

        if visited.contains(&oid) {
            continue;
        }
        visited.insert(oid);

        let commit = repo.find_commit(oid)?;
        let parent_ids: Vec<String> = commit
            .parent_ids()
            .map(|id| id.to_string()[..7].to_string())
            .collect();

        let references = oid_to_refs.get(&oid).cloned();

        let history_item = HistoryItem {
            id: oid.to_string()[..7].to_string(),
            parent_ids,
            subject: commit
                .summary()
                .unwrap_or("(no message)")
                .to_string(),
            author: commit
                .author()
                .name()
                .unwrap_or("Unknown")
                .to_string(),
            timestamp: commit.time().seconds() * 1000,
            references,
            summary: None,
        };

        items.push(history_item);
    }

    let head = repo.head()?;
    let current_ref = if let Some(name) = head.name() {
        let short_name = name.strip_prefix("refs/heads/").unwrap_or(name);

        let target = head.target();
        Some(HistoryItemRef {
            id: name.to_string(),
            name: short_name.to_string(),
            revision: target.map(|oid| oid.to_string()[..7].to_string()),
            color: None,
            icon: Some("branch".to_string()),
        })
    } else {
        None
    };

    let current_remote_ref = if let Some(ref current) = current_ref {
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
    } else {
        None
    };

    Ok(HistoryProviderSnapshot {
        items,
        current_ref,
        current_remote_ref,
        current_base_ref: None,
    })
}
