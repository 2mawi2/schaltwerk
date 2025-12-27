use base64::prelude::*;
use serde::Serialize;
use tauri::{AppHandle, Manager};

const PICKED_PREFIX: &str = "#__schaltwerk_picked=";

#[derive(Serialize)]
pub struct PickerPollResult {
    pub html: Option<String>,
}

#[tauri::command]
pub async fn preview_poll_picked_element(
    app: AppHandle,
    label: String,
) -> Result<PickerPollResult, String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview with label '{label}' not found"))?;

    let url = webview
        .url()
        .map_err(|e| format!("Failed to get webview URL: {e}"))?;

    let fragment = url.fragment().unwrap_or("");
    let full_hash = format!("#{fragment}");

    if let Some(encoded) = full_hash.strip_prefix(PICKED_PREFIX) {
        webview
            .eval("window.location.hash = ''")
            .map_err(|e| format!("Failed to clear hash: {e}"))?;

        let decoded_bytes = BASE64_STANDARD
            .decode(encoded)
            .map_err(|e| format!("Failed to decode base64: {e}"))?;

        let html = String::from_utf8(decoded_bytes)
            .map_err(|e| format!("Invalid UTF-8 in decoded HTML: {e}"))?;

        return Ok(PickerPollResult { html: Some(html) });
    }

    Ok(PickerPollResult { html: None })
}

#[tauri::command]
pub async fn preview_eval_script(app: AppHandle, label: String, script: String) -> Result<(), String> {
    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview with label '{label}' not found"))?;

    webview
        .eval(&script)
        .map_err(|e| format!("Failed to evaluate script: {e}"))
}

#[tauri::command]
pub async fn preview_enable_element_picker(app: AppHandle, label: String) -> Result<(), String> {
    let script = include_str!("../scripts/element_picker.js");

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview with label '{label}' not found"))?;

    webview
        .eval(script)
        .map_err(|e| format!("Failed to enable element picker: {e}"))
}

#[tauri::command]
pub async fn preview_disable_element_picker(app: AppHandle, label: String) -> Result<(), String> {
    let script = r#"
        if (window.__schaltwerk_element_picker) {
            window.__schaltwerk_element_picker.disable();
        }
    "#;

    let webview = app
        .get_webview(&label)
        .ok_or_else(|| format!("Webview with label '{label}' not found"))?;

    webview
        .eval(script)
        .map_err(|e| format!("Failed to disable element picker: {e}"))
}
