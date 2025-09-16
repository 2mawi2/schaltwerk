use super::types::{AgentBinaryConfig, Settings};

pub fn clean_invalid_binary_paths(settings: &mut Settings) {
    let fix_config = |config: &mut Option<AgentBinaryConfig>| {
        if let Some(cfg) = config {
            if let Some(ref path) = cfg.custom_path.clone() {
                if path.ends_with(".js") || path.ends_with(".mjs") {
                    log::warn!(
                        "Found JS file path for {}: {}, attempting to fix",
                        cfg.agent_name,
                        path
                    );

                    let possible_locations = vec![
                        format!("/opt/homebrew/bin/{}", cfg.agent_name),
                        format!("/usr/local/bin/{}", cfg.agent_name),
                        format!("/opt/homebrew/Cellar/node/24.4.0/bin/{}", cfg.agent_name),
                        format!(
                            "{}/.local/bin/{}",
                            std::env::var("HOME").unwrap_or_default(),
                            cfg.agent_name
                        ),
                    ];

                    let mut found_wrapper = None;
                    for location in &possible_locations {
                        if std::path::Path::new(location).exists() {
                            log::info!(
                                "Found correct binary wrapper at {location}, replacing JS path"
                            );
                            found_wrapper = Some(location.clone());
                            break;
                        }
                    }

                    if let Some(wrapper) = found_wrapper {
                        cfg.custom_path = Some(wrapper);
                    } else {
                        log::warn!(
                            "Could not find binary wrapper for {}, reverting to auto-detect",
                            cfg.agent_name
                        );
                        cfg.custom_path = None;
                        cfg.auto_detect = true;
                    }
                }
            }
        }
    };

    fix_config(&mut settings.agent_binaries.claude);
    fix_config(&mut settings.agent_binaries.cursor_agent);
    fix_config(&mut settings.agent_binaries.opencode);
    fix_config(&mut settings.agent_binaries.gemini);
    fix_config(&mut settings.agent_binaries.codex);
}
