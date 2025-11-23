use chrono::Utc;
use schaltwerk::domains::agents::naming::{generate_spec_display_name, NameGenerationArgs};
use schaltwerk::domains::sessions::entity::Spec;
use schaltwerk::infrastructure::database::Database;
use schaltwerk::infrastructure::database::SpecMethods;
use std::fs;
use std::os::unix::fs::PermissionsExt;
use tempfile::TempDir;

#[tokio::test]
async fn spec_name_generation_updates_spec_display_name() {
    let temp_dir = TempDir::new().unwrap();
    let db_path = temp_dir.path().join("sessions.db");
    let repo_path = temp_dir.path().join("repo");
    fs::create_dir_all(&repo_path).unwrap();

    let db = Database::new(Some(db_path)).unwrap();
    let spec = Spec {
        id: "spec-1".to_string(),
        name: "my-spec".to_string(),
        display_name: None,
        repository_path: repo_path.clone(),
        repository_name: "repo".to_string(),
        content: "Build the docs for the API".to_string(),
        created_at: Utc::now(),
        updated_at: Utc::now(),
    };

    db.create_spec(&spec).unwrap();

    let bin_dir = temp_dir.path().join("bin");
    fs::create_dir_all(&bin_dir).unwrap();
    let fake_claude = bin_dir.join("claude");
    fs::write(&fake_claude, "#!/bin/sh\necho docs-api\n").unwrap();
    let mut perms = fs::metadata(&fake_claude).unwrap().permissions();
    perms.set_mode(0o755);
    fs::set_permissions(&fake_claude, perms).unwrap();

    let fake_claude_lossy = fake_claude.to_string_lossy();
    let args = NameGenerationArgs {
        db: &db,
        target_id: &spec.id,
        worktree_path: std::path::Path::new(""),
        agent_type: "claude",
        initial_prompt: Some(&spec.content),
        cli_args: None,
        env_vars: &[],
        binary_path: Some(fake_claude_lossy.as_ref()),
    };

    let result = generate_spec_display_name(args).await.unwrap();

    assert_eq!(result.as_deref(), Some("docs-api"));
    let stored = db.get_spec_by_id(&spec.id).unwrap();
    assert_eq!(stored.display_name.as_deref(), Some("docs-api"));
}
