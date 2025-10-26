use anyhow::Result;
use git2::{Oid, Repository};

use crate::domains::merge::service::{compute_merge_state, resolve_branch_oid};
use crate::domains::merge::types::{MergePreview, MergeState};

/// Facade providing read-only access to merge status information for other domains.
pub struct MergeSnapshotGateway;

impl MergeSnapshotGateway {
    /// Compute a merge state snapshot for the given pair of branches.
    pub fn compute(
        repo: &Repository,
        session_oid: Oid,
        parent_oid: Oid,
        session_branch: &str,
        parent_branch: &str,
    ) -> Result<MergeStateSnapshot> {
        let state =
            compute_merge_state(repo, session_oid, parent_oid, session_branch, parent_branch)?;
        Ok(Self::from_state(Some(state)))
    }

    /// Resolve the HEAD commit for a branch.
    pub fn resolve_branch_oid(repo: &Repository, branch: &str) -> Result<Oid> {
        resolve_branch_oid(repo, branch)
    }

    /// Convert an optional merge state into a snapshot.
    pub fn from_state(state: Option<MergeState>) -> MergeStateSnapshot {
        MergeStateSnapshot::from_state(state)
    }

    /// Convert an optional merge preview into a snapshot.
    pub fn from_preview(preview: Option<&MergePreview>) -> MergeStateSnapshot {
        MergeStateSnapshot::from_preview(preview)
    }
}

pub use crate::domains::merge::types::MergeStateSnapshot;

#[cfg(test)]
mod tests {
    use super::*;
    use git2::{Oid, Repository, Signature};
    use tempfile::TempDir;

    fn create_commit(repo: &Repository, message: &str, file: &str, content: &str) -> Oid {
        use std::fs;
        let signature = Signature::now("Tester", "tester@example.com").unwrap();

        let tree_oid = {
            let mut index = repo.index().unwrap();
            let path = repo.workdir().unwrap().join(file);
            fs::write(&path, content).unwrap();
            index.add_path(std::path::Path::new(file)).unwrap();
            index.write().unwrap();
            index.write_tree().unwrap()
        };

        let tree = repo.find_tree(tree_oid).unwrap();
        let parent = repo
            .head()
            .ok()
            .and_then(|h| h.target())
            .map(|oid| repo.find_commit(oid).unwrap());

        match parent {
            Some(parent_commit) => repo
                .commit(
                    Some("HEAD"),
                    &signature,
                    &signature,
                    message,
                    &tree,
                    &[&parent_commit],
                )
                .unwrap(),
            None => repo
                .commit(Some("HEAD"), &signature, &signature, message, &tree, &[])
                .unwrap(),
        }
    }

    #[test]
    fn compute_snapshot_for_divergent_branch() {
        let temp = TempDir::new().unwrap();
        let repo = Repository::init(temp.path()).unwrap();

        // Initial commit on main.
        let initial_oid = create_commit(&repo, "initial", "README.md", "hello");

        // Ensure main branch exists and points to initial commit.
        if repo.find_branch("main", git2::BranchType::Local).is_err() {
            repo.branch("main", &repo.find_commit(initial_oid).unwrap(), false)
                .unwrap();
        }
        repo.set_head("refs/heads/main").unwrap();

        // Create feature branch and new commit.
        let main_oid = repo.head().unwrap().target().unwrap();
        repo.branch("feature", &repo.find_commit(main_oid).unwrap(), false)
            .unwrap();
        repo.set_head("refs/heads/feature").unwrap();
        repo.checkout_head(None).unwrap();
        create_commit(&repo, "feature work", "feature.txt", "work");

        let session_oid = MergeSnapshotGateway::resolve_branch_oid(&repo, "feature").unwrap();
        let parent_oid = MergeSnapshotGateway::resolve_branch_oid(&repo, "main").unwrap();
        let snapshot =
            MergeSnapshotGateway::compute(&repo, session_oid, parent_oid, "feature", "main")
                .unwrap();

        assert_eq!(snapshot.merge_is_up_to_date, Some(false));
        assert_eq!(snapshot.merge_has_conflicts, Some(false));
    }

    #[test]
    fn from_preview_round_trips() {
        let preview = MergePreview {
            session_branch: "feature".into(),
            parent_branch: "main".into(),
            squash_commands: vec![],
            reapply_commands: vec![],
            default_commit_message: "Merge feature".into(),
            has_conflicts: true,
            conflicting_paths: vec!["src/lib.rs".into()],
            is_up_to_date: false,
        };

        let snapshot = MergeSnapshotGateway::from_preview(Some(&preview));
        assert_eq!(snapshot.merge_has_conflicts, Some(true));
        assert_eq!(snapshot.merge_is_up_to_date, Some(false));
        assert_eq!(
            snapshot.merge_conflicting_paths,
            Some(vec!["src/lib.rs".into()])
        );
    }
}
