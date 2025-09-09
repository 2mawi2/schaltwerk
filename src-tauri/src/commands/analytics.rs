use schaltwerk::domains::analytics;

#[tauri::command]
pub async fn get_analytics_consent() -> Result<bool, String> {
    analytics::get_analytics_consent().await
}

#[tauri::command]
pub async fn get_analytics_consent_status() -> Result<analytics::AnalyticsConfig, String> {
    analytics::get_analytics_consent_status().await
}

#[tauri::command]
pub async fn set_analytics_consent(consent: bool) -> Result<(), String> {
    analytics::set_analytics_consent(consent).await
}