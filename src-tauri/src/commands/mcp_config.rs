use std::path::PathBuf;
use std::process::Command;
use serde::{Deserialize, Serialize};

const MCP_SERVER_PATH: &str = "mcp-server/build/schaltwerk-mcp-server.js";

// Claude-specific configuration logic
mod claude {
    use super::*;
    
    pub fn check_cli_availability() -> bool {
        Command::new("which")
            .arg("claude")
            .output()
            .map(|output| output.status.success())
            .unwrap_or(false)
    }
    
    pub fn configure_mcp(project_path: &str, mcp_server_path: &str) -> Result<String, String> {
        let output = Command::new("claude")
            .args([
                "mcp", "add",
                "--transport", "stdio",
                "--scope", "project",
                "schaltwerk",
                "node",
                mcp_server_path
            ])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run claude CLI: {e}"))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("Claude CLI failed: {stderr}");
            return Err(format!("Claude CLI failed: {stderr}"));
        }
        
        let stdout = String::from_utf8_lossy(&output.stdout);
        log::info!("MCP configured successfully: {stdout}");
        Ok("MCP server configured successfully for this project".to_string())
    }
    
    pub fn remove_mcp(project_path: &str) -> Result<String, String> {
        let output = Command::new("claude")
            .args(["mcp", "remove", "schaltwerk"])
            .current_dir(project_path)
            .output()
            .map_err(|e| format!("Failed to run claude CLI: {e}"))?;
        
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            log::error!("Failed to remove MCP: {stderr}");
            return Err(format!("Failed to remove MCP: {stderr}"));
        }
        
        log::info!("MCP configuration removed successfully");
        Ok("MCP server removed from project".to_string())
    }
    
    pub fn generate_setup_command(mcp_server_path: &str) -> String {
        format!("claude mcp add --transport stdio --scope project schaltwerk node \"{mcp_server_path}\"")
    }
}

fn detect_mcp_server_location(exe_path: &std::path::Path) -> Result<(PathBuf, bool), String> {
    let exe_path_str = exe_path.to_string_lossy();
    let is_app_bundle = exe_path_str.contains(".app/Contents/MacOS/");
    
    if is_app_bundle {
        get_app_bundle_mcp_path(exe_path)
    } else if cfg!(debug_assertions) {
        get_development_mcp_path()
    } else {
        get_release_mcp_path(exe_path)
    }
}

fn get_app_bundle_mcp_path(exe_path: &std::path::Path) -> Result<(PathBuf, bool), String> {
    log::debug!("Running from app bundle: {}", exe_path.display());
    let mcp_embedded = if cfg!(target_os = "macos") {
        exe_path
            .parent().unwrap()  // MacOS
            .parent().unwrap()  // Contents
            .join("Resources").join(MCP_SERVER_PATH)
    } else {
        // For other platforms, adjust path as needed
        exe_path
            .parent().unwrap()
            .join(MCP_SERVER_PATH)
    };
    
    if !mcp_embedded.exists() {
        log::error!("MCP server not found in app bundle at: {mcp_embedded:?}");
        return Err("MCP server not found in app bundle".to_string());
    }
    
    log::debug!("Using embedded MCP server at: {mcp_embedded:?}");
    Ok((mcp_embedded, true))
}

fn get_development_mcp_path() -> Result<(PathBuf, bool), String> {
    log::debug!("Running in development mode");
    let manifest_dir = env!("CARGO_MANIFEST_DIR");
    let project_root = PathBuf::from(manifest_dir).parent().unwrap().to_path_buf();
    let mcp_dev_path = project_root.join(MCP_SERVER_PATH);
    
    if mcp_dev_path.exists() {
        log::debug!("Using development MCP server at: {mcp_dev_path:?}");
        Ok((mcp_dev_path, false))
    } else {
        log::warn!("MCP server not built in development mode");
        Err("MCP server not built. Run 'cd mcp-server && npm run build'".to_string())
    }
}

fn get_release_mcp_path(exe_path: &std::path::Path) -> Result<(PathBuf, bool), String> {
    log::debug!("Running in release mode outside app bundle: {}", exe_path.display());
    let mcp_embedded = exe_path
        .parent().unwrap()
        .join(MCP_SERVER_PATH);
    
    if !mcp_embedded.exists() {
        log::error!("MCP server not found at: {mcp_embedded:?}");
        return Err("MCP server not found in release build".to_string());
    }
    
    log::debug!("Using release MCP server at: {mcp_embedded:?}");
    Ok((mcp_embedded, true))
}

fn check_claude_cli_availability() -> bool {
    claude::check_cli_availability()
}

fn check_mcp_configuration_status(project_path: &str) -> bool {
    let mcp_config_path = PathBuf::from(project_path).join(".mcp.json");
    if mcp_config_path.exists() {
        std::fs::read_to_string(&mcp_config_path)
            .map(|content| content.contains("\"schaltwerk\""))
            .unwrap_or(false)
    } else {
        false
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct MCPStatus {
    pub mcp_server_path: String,
    pub is_embedded: bool,
    pub claude_cli_available: bool,
    pub is_configured: bool,
    pub setup_command: String,
    pub project_path: String,
}

#[tauri::command]
pub async fn get_mcp_status(project_path: String) -> Result<MCPStatus, String> {
    log::debug!("Getting MCP status for project: {project_path}");
    
    // Detect MCP server location based on build type
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    
    let (mcp_path, is_embedded) = detect_mcp_server_location(&exe_path)?;
    
    // Check if claude CLI is available
    let claude_available = check_claude_cli_availability();
    log::debug!("Claude CLI available: {claude_available}");
    
    // Check if MCP is already configured for this project
    let is_configured = check_mcp_configuration_status(&project_path);
    log::debug!("MCP configured for project: {is_configured}");
    
    // Generate setup command
    let setup_command = claude::generate_setup_command(&mcp_path.to_string_lossy());
    
    Ok(MCPStatus {
        mcp_server_path: mcp_path.to_string_lossy().to_string(),
        is_embedded,
        claude_cli_available: claude_available,
        is_configured,
        setup_command,
        project_path,
    })
}

#[tauri::command]
pub async fn configure_mcp_for_project(project_path: String) -> Result<String, String> {
    log::info!("Configuring MCP for project: {project_path}");
    
    let status = get_mcp_status(project_path.clone()).await?;
    
    if !status.claude_cli_available {
        log::warn!("Claude CLI not available");
        return Err("Claude CLI not found. Please install Claude Code first.".to_string());
    }
    
    // Execute Claude MCP configuration
    claude::configure_mcp(&project_path, &status.mcp_server_path)
}

#[tauri::command]
pub async fn remove_mcp_for_project(project_path: String) -> Result<String, String> {
    log::info!("Removing MCP configuration for project: {project_path}");
    
    claude::remove_mcp(&project_path)
}

#[tauri::command]
pub async fn ensure_mcp_gitignored(project_path: String) -> Result<String, String> {
    log::info!("Ensuring .mcp.json is in gitignore for project: {project_path}");
    
    let gitignore_path = PathBuf::from(&project_path).join(".gitignore");
    let mcp_entry = ".mcp.json";
    
    // Read existing gitignore if it exists
    let mut gitignore_content = if gitignore_path.exists() {
        std::fs::read_to_string(&gitignore_path)
            .map_err(|e| format!("Failed to read .gitignore: {e}"))?
    } else {
        String::new()
    };
    
    // Check if .mcp.json is already ignored
    if gitignore_content.lines().any(|line| line.trim() == mcp_entry) {
        log::debug!(".mcp.json already in gitignore");
        return Ok("Already ignored".to_string());
    }
    
    // Add .mcp.json to gitignore
    if !gitignore_content.is_empty() && !gitignore_content.ends_with('\n') {
        gitignore_content.push('\n');
    }
    gitignore_content.push_str(mcp_entry);
    gitignore_content.push('\n');
    
    // Write updated gitignore
    std::fs::write(&gitignore_path, gitignore_content)
        .map_err(|e| format!("Failed to write .gitignore: {e}"))?;
    
    log::info!("Added .mcp.json to gitignore");
    Ok("Added to gitignore".to_string())
}