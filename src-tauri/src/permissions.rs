use std::path::Path;
use std::fs;

#[tauri::command]
pub async fn check_folder_access(path: String) -> Result<bool, String> {
    let path = Path::new(&path);
    
    match fs::read_dir(path) {
        Ok(_) => Ok(true),
        Err(e) => {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                log::info!("Permission denied for folder: {}", path.display());
                Ok(false)
            } else if e.kind() == std::io::ErrorKind::NotFound {
                log::info!("Folder not found: {}", path.display());
                Err(format!("Folder not found: {}", path.display()))
            } else {
                log::error!("Error accessing folder {}: {}", path.display(), e);
                Err(format!("Error accessing folder: {e}"))
            }
        }
    }
}

#[tauri::command]
pub async fn trigger_folder_permission_request(path: String) -> Result<(), String> {
    let path = Path::new(&path);
    
    log::info!("Attempting to trigger permission request for: {}", path.display());
    
    match fs::read_dir(path) {
        Ok(mut entries) => {
            if let Some(Ok(_)) = entries.next() {
                log::info!("Successfully accessed folder: {}", path.display());
                Ok(())
            } else {
                log::info!("Folder is empty but accessible: {}", path.display());
                Ok(())
            }
        }
        Err(e) => {
            if e.kind() == std::io::ErrorKind::PermissionDenied {
                log::info!("Permission dialog should have been triggered for: {}", path.display());
                Err("Permission required - please grant access when prompted".to_string())
            } else {
                log::error!("Error accessing folder {}: {}", path.display(), e);
                Err(format!("Error accessing folder: {e}"))
            }
        }
    }
}

#[tauri::command]
pub async fn ensure_folder_permission(path: String) -> Result<(), String> {
    trigger_folder_permission_request(path).await
}

