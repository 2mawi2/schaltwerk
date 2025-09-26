use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum MergeMode {
    Squash,
    Reapply,
}

impl MergeMode {
    pub fn as_str(&self) -> &'static str {
        match self {
            MergeMode::Squash => "squash",
            MergeMode::Reapply => "reapply",
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergePreview {
    pub session_branch: String,
    pub parent_branch: String,
    pub squash_commands: Vec<String>,
    pub reapply_commands: Vec<String>,
    pub default_commit_message: String,
    pub has_conflicts: bool,
    pub conflicting_paths: Vec<String>,
    pub is_up_to_date: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeState {
    pub has_conflicts: bool,
    pub conflicting_paths: Vec<String>,
    pub is_up_to_date: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct MergeStateSnapshot {
    pub merge_has_conflicts: Option<bool>,
    pub merge_conflicting_paths: Option<Vec<String>>,
    pub merge_is_up_to_date: Option<bool>,
}

impl MergeStateSnapshot {
    pub fn from_state(state: Option<MergeState>) -> Self {
        match state {
            Some(state) => Self {
                merge_has_conflicts: Some(state.has_conflicts),
                merge_conflicting_paths: if state.conflicting_paths.is_empty() {
                    None
                } else {
                    Some(state.conflicting_paths)
                },
                merge_is_up_to_date: Some(state.is_up_to_date),
            },
            None => Self::default(),
        }
    }

    pub fn from_preview(preview: Option<&MergePreview>) -> Self {
        match preview {
            Some(preview) => Self {
                merge_has_conflicts: Some(preview.has_conflicts),
                merge_conflicting_paths: if preview.conflicting_paths.is_empty() {
                    None
                } else {
                    Some(preview.conflicting_paths.clone())
                },
                merge_is_up_to_date: Some(preview.is_up_to_date),
            },
            None => Self::default(),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MergeOutcome {
    pub session_branch: String,
    pub parent_branch: String,
    pub new_commit: String,
    pub mode: MergeMode,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn snapshot_from_none_defaults() {
        let snapshot = MergeStateSnapshot::from_state(None);
        assert_eq!(snapshot, MergeStateSnapshot::default());

        let preview_snapshot = MergeStateSnapshot::from_preview(None);
        assert_eq!(preview_snapshot, MergeStateSnapshot::default());
    }

    #[test]
    fn snapshot_from_state_normalizes_conflict_paths() {
        let state = MergeState {
            has_conflicts: true,
            conflicting_paths: vec!["a.txt".into(), "b.rs".into()],
            is_up_to_date: false,
        };
        let snapshot = MergeStateSnapshot::from_state(Some(state.clone()));
        assert_eq!(snapshot.merge_has_conflicts, Some(true));
        assert_eq!(snapshot.merge_is_up_to_date, Some(false));
        assert_eq!(
            snapshot.merge_conflicting_paths,
            Some(vec!["a.txt".into(), "b.rs".into()])
        );

        // Empty conflict list should normalize to None
        let no_conflict_snapshot = MergeStateSnapshot::from_state(Some(MergeState {
            conflicting_paths: Vec::new(),
            ..state
        }));
        assert_eq!(no_conflict_snapshot.merge_conflicting_paths, None);
    }

    #[test]
    fn snapshot_from_preview_clones_paths() {
        let preview = MergePreview {
            session_branch: "feature".into(),
            parent_branch: "main".into(),
            squash_commands: vec![],
            reapply_commands: vec![],
            default_commit_message: String::new(),
            has_conflicts: false,
            conflicting_paths: vec!["conflict.txt".into()],
            is_up_to_date: true,
        };
        let snapshot = MergeStateSnapshot::from_preview(Some(&preview));
        assert_eq!(snapshot.merge_has_conflicts, Some(false));
        assert_eq!(snapshot.merge_is_up_to_date, Some(true));
        assert_eq!(
            snapshot.merge_conflicting_paths,
            Some(vec!["conflict.txt".into()])
        );
        // ensure preview not consumed
        assert_eq!(preview.conflicting_paths.len(), 1);
    }
}
