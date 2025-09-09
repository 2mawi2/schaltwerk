use serde::{Deserialize, Serialize};
use std::sync::{Arc, RwLock};

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct AnalyticsConfig {
    pub consent_given: bool,
    pub consent_asked: bool,
}

pub struct AnalyticsState {
    config: RwLock<AnalyticsConfig>,
}

impl AnalyticsState {
    pub fn new() -> Arc<Self> {
        let config = Self::load_config().unwrap_or_default();
        Arc::new(Self {
            config: RwLock::new(config),
        })
    }
    
    fn load_config() -> Result<AnalyticsConfig, Box<dyn std::error::Error>> {
        let config_dir = dirs::config_dir()
            .ok_or("Failed to get config directory")?;
        let config_path = config_dir.join("schaltwerk").join("analytics.json");
        
        if !config_path.exists() {
            return Ok(AnalyticsConfig::default());
        }
        
        let content = std::fs::read_to_string(&config_path)?;
        let config: AnalyticsConfig = serde_json::from_str(&content)?;
        Ok(config)
    }
    
    fn save_config(&self) -> Result<(), Box<dyn std::error::Error>> {
        let config_dir = dirs::config_dir()
            .ok_or("Failed to get config directory")?;
        let schaltwerk_dir = config_dir.join("schaltwerk");
        
        if !schaltwerk_dir.exists() {
            std::fs::create_dir_all(&schaltwerk_dir)?;
        }
        
        let config_path = schaltwerk_dir.join("analytics.json");
        let config = self.config.read().unwrap();
        let content = serde_json::to_string_pretty(&*config)?;
        std::fs::write(&config_path, content)?;
        Ok(())
    }
}

#[tauri::command]
pub async fn get_analytics_consent() -> Result<bool, String> {
    let state = get_analytics_state().await;
    let config = state.config.read().map_err(|e| e.to_string())?;
    Ok(config.consent_given)
}

#[tauri::command]
pub async fn get_analytics_consent_status() -> Result<AnalyticsConfig, String> {
    let state = get_analytics_state().await;
    let config = state.config.read().map_err(|e| e.to_string())?;
    Ok(config.clone())
}

#[tauri::command]
pub async fn set_analytics_consent(
    consent: bool,
) -> Result<(), String> {
    let state = get_analytics_state().await;
    {
        let mut config = state.config.write().map_err(|e| e.to_string())?;
        config.consent_given = consent;
        config.consent_asked = true;
    }
    
    state.save_config().map_err(|e| e.to_string())?;
    
    log::info!("Analytics consent updated: {consent}");
    Ok(())
}

use tokio::sync::OnceCell;

pub static ANALYTICS_STATE: OnceCell<Arc<AnalyticsState>> = OnceCell::const_new();

pub async fn get_analytics_state() -> Arc<AnalyticsState> {
    ANALYTICS_STATE.get_or_init(|| async {
        AnalyticsState::new()
    }).await.clone()
}