use schaltwerk::domains::settings::AgentBinaryConfig;
use schaltwerk::binary_detector::{DetectedBinary, BinaryDetector};
use crate::SETTINGS_MANAGER;
use log::{debug, info};

#[tauri::command]
pub async fn detect_agent_binaries(agent_name: String) -> Result<Vec<DetectedBinary>, String> {
    info!("Detecting binaries for agent: {agent_name}");
    
    let detected_binaries = BinaryDetector::detect_agent_binaries(&agent_name);
    
    // Save the detected binaries to settings
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    let mut settings = settings_manager.lock().await;
    
    let config = AgentBinaryConfig {
        agent_name: agent_name.clone(),
        custom_path: settings.get_agent_binary_config(&agent_name)
            .and_then(|c| c.custom_path),
        auto_detect: true,
        detected_binaries: detected_binaries.clone(),
    };
    
    settings.set_agent_binary_config(config)?;
    
    Ok(detected_binaries)
}

#[tauri::command]
pub async fn get_agent_binary_config(agent_name: String) -> Result<AgentBinaryConfig, String> {
    debug!("Getting binary configuration for agent: {agent_name}");
    
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    let settings = settings_manager.lock().await;
    
    if let Some(config) = settings.get_agent_binary_config(&agent_name) {
        Ok(config)
    } else {
        // Create default config with detection
        let detected_binaries = BinaryDetector::detect_agent_binaries(&agent_name);
        Ok(AgentBinaryConfig {
            agent_name,
            custom_path: None,
            auto_detect: true,
            detected_binaries,
        })
    }
}

#[tauri::command]
pub async fn set_agent_binary_path(agent_name: String, path: Option<String>) -> Result<(), String> {
    info!("Setting binary path for agent {agent_name}: {path:?}");
    
    // Validate and process the path
    let processed_path = if let Some(p) = &path {
        // Check if this looks like a resolved symlink to a .js file
        if p.ends_with(".js") || p.ends_with(".mjs") {
            // Try to find the original executable wrapper
            log::warn!("Detected JavaScript file path, may be resolved symlink: {p}");
            
            // Check if there's a binary wrapper in common locations
            let possible_locations = vec![
                format!("/opt/homebrew/bin/{}", agent_name),
                format!("/usr/local/bin/{}", agent_name),
                format!("/opt/homebrew/Cellar/node/24.4.0/bin/{}", agent_name),
                format!("{}/.local/bin/{}", std::env::var("HOME").unwrap_or_default(), agent_name),
            ];
            
            let mut found_wrapper = None;
            for location in &possible_locations {
                if std::path::Path::new(location).exists() {
                    log::info!("Found binary wrapper at {location}, using that instead of .js file");
                    found_wrapper = Some(location.clone());
                    break;
                }
            }
            
            if let Some(wrapper) = found_wrapper {
                Some(wrapper)
            } else {
                // If we can't find a wrapper, return error
                return Err(format!(
                    "The selected file appears to be a JavaScript file. Please select the executable wrapper instead. \
                    Try looking in /opt/homebrew/bin/{agent_name} or /usr/local/bin/{agent_name}"
                ));
            }
        } else {
            Some(p.clone())
        }
    } else {
        None
    };
    
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    let mut settings = settings_manager.lock().await;
    
    let existing_config = settings.get_agent_binary_config(&agent_name);
    let detected_binaries = existing_config
        .as_ref()
        .map(|c| c.detected_binaries.clone())
        .unwrap_or_else(|| BinaryDetector::detect_agent_binaries(&agent_name));
    
    let config = AgentBinaryConfig {
        agent_name,
        custom_path: processed_path,
        auto_detect: path.is_none(),
        detected_binaries,
    };
    
    settings.set_agent_binary_config(config)
}

#[tauri::command]
pub async fn get_effective_agent_binary_path(agent_name: String) -> Result<String, String> {
    debug!("Getting effective binary path for agent: {agent_name}");
    
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    let settings = settings_manager.lock().await;
    
    if let Some(config) = settings.get_agent_binary_config(&agent_name) {
        if let Some(custom_path) = &config.custom_path {
            debug!("Using custom binary path for {agent_name}: {custom_path}");
            return Ok(custom_path.clone());
        }
        
        if let Some(recommended) = config.detected_binaries.iter().find(|b| b.is_recommended) {
            debug!("Using recommended binary path for {}: {}", agent_name, recommended.path);
            return Ok(recommended.path.clone());
        }
        
        if let Some(first) = config.detected_binaries.first() {
            debug!("Using first available binary path for {}: {}", agent_name, first.path);
            return Ok(first.path.clone());
        }
    }
    
    debug!("No binary detected for {agent_name}, using command name as fallback");
    Ok(agent_name)
}

#[tauri::command]
pub async fn get_all_agent_binary_configs() -> Result<Vec<AgentBinaryConfig>, String> {
    info!("Getting all agent binary configurations");
    
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    let mut settings = settings_manager.lock().await;
    
    let known_agents = vec!["claude", "cursor-agent", "codex", "opencode", "gemini", "qwen"];
    let mut configs = Vec::new();
    
    for agent in known_agents {
        if let Some(config) = settings.get_agent_binary_config(agent) {
            configs.push(config);
        } else {
            // Create default config with detection
            let detected_binaries = BinaryDetector::detect_agent_binaries(agent);
            let config = AgentBinaryConfig {
                agent_name: agent.to_string(),
                custom_path: None,
                auto_detect: true,
                detected_binaries,
            };
            
            // Save it for future use
            if let Err(e) = settings.set_agent_binary_config(config.clone()) {
                log::warn!("Failed to save binary config for {agent}: {e}");
            }
            configs.push(config);
        }
    }
    
    Ok(configs)
}

#[tauri::command]
pub async fn detect_all_agent_binaries() -> Result<Vec<AgentBinaryConfig>, String> {
    info!("Running full detection for all agents");
    
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    let mut settings = settings_manager.lock().await;
    
    let known_agents = vec!["claude", "cursor-agent", "codex", "opencode", "gemini", "qwen"];
    let mut configs = Vec::new();
    
    for agent in known_agents {
        let detected_binaries = BinaryDetector::detect_agent_binaries(agent);
        
        let existing_config = settings.get_agent_binary_config(agent);
        let custom_path = existing_config.and_then(|c| c.custom_path);
        
        let config = AgentBinaryConfig {
            agent_name: agent.to_string(),
            custom_path: custom_path.clone(),
            auto_detect: custom_path.is_none(),
            detected_binaries,
        };
        
        if let Err(e) = settings.set_agent_binary_config(config.clone()) {
            log::warn!("Failed to save binary config for {agent}: {e}");
        }
        configs.push(config);
    }
    
    Ok(configs)
}

#[tauri::command]
pub async fn refresh_agent_binary_detection(agent_name: String) -> Result<AgentBinaryConfig, String> {
    info!("Refreshing binary detection for agent: {agent_name}");
    
    let settings_manager = SETTINGS_MANAGER
        .get()
        .ok_or_else(|| "Settings manager not initialized".to_string())?;
    let mut settings = settings_manager.lock().await;
    
    let detected_binaries = BinaryDetector::detect_agent_binaries(&agent_name);
    
    let existing_config = settings.get_agent_binary_config(&agent_name);
    let custom_path = existing_config.and_then(|c| c.custom_path);
    
    let config = AgentBinaryConfig {
        agent_name,
        custom_path: custom_path.clone(),
        auto_detect: custom_path.is_none(),
        detected_binaries,
    };
    
    settings.set_agent_binary_config(config.clone())?;
    
    Ok(config)
}