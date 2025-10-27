use crate::{
    SETTINGS_MANAGER,
    commands::schaltwerk_core::{agent_ctx, codex_models, schaltwerk_core_cli},
    get_core_read,
};
use schaltwerk::domains::agents::manifest::AgentManifest;

#[tauri::command]
pub async fn schaltwerk_core_list_codex_models(
) -> Result<codex_models::CodexModelCatalog, String> {
    use codex_models::{builtin_codex_model_catalog, fetch_codex_model_catalog};

    let (repo_path, db) = {
        let core = get_core_read().await?;
        (core.repo_path.clone(), core.db.clone())
    };

    let (env_vars, cli_args_text, _) = agent_ctx::collect_agent_env_and_cli(
        &agent_ctx::AgentKind::Codex,
        &repo_path,
        &db,
    )
    .await;

    let cli_args = if cli_args_text.trim().is_empty() {
        Vec::new()
    } else {
        let normalized = schaltwerk_core_cli::normalize_cli_text(&cli_args_text);
        match shell_words::split(&normalized) {
            Ok(parts) => parts,
            Err(_) => vec![cli_args_text],
        }
    };

    let binary_path = if let Some(settings_manager) = SETTINGS_MANAGER.get() {
        let manager = settings_manager.lock().await;
        manager
            .get_effective_binary_path("codex")
            .unwrap_or_else(|_| {
                AgentManifest::get("codex")
                    .map(|manifest| manifest.default_binary_path.clone())
                    .unwrap_or_else(|| "codex".to_string())
            })
    } else {
        AgentManifest::get("codex")
            .map(|manifest| manifest.default_binary_path.clone())
            .unwrap_or_else(|| "codex".to_string())
    };

    match fetch_codex_model_catalog(&binary_path, &env_vars, &cli_args).await {
        Ok(catalog) => Ok(catalog),
        Err(err) => {
            log::warn!(
                "Falling back to built-in Codex models after discovery error: {err}"
            );
            Ok(builtin_codex_model_catalog())
        }
    }
}
