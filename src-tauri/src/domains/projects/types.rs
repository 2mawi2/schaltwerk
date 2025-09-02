use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::fs;
use serde::{Deserialize, Serialize};
use anyhow::Result;
use chrono::Utc;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct RecentProject {
    pub path: String,
    pub name: String,
    #[serde(rename = "lastOpened")]
    pub last_opened: i64,
}

#[derive(Debug, Default, Serialize, Deserialize)]
pub struct ProjectHistory {
    projects: HashMap<String, RecentProject>,
}

impl ProjectHistory {
    pub fn load() -> Result<Self> {
        let config_path = Self::config_path()?;
        
        if !config_path.exists() {
            return Ok(Self::default());
        }
        
        let content = fs::read_to_string(&config_path)?;
        let history: ProjectHistory = serde_json::from_str(&content)?;
        Ok(history)
    }
    
    pub fn save(&self) -> Result<()> {
        let config_path = Self::config_path()?;
        
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent)?;
        }
        
        let content = serde_json::to_string_pretty(&self)?;
        fs::write(config_path, content)?;
        Ok(())
    }
    
    fn config_path() -> Result<PathBuf> {
        let config_dir = dirs::config_dir()
            .ok_or_else(|| anyhow::anyhow!("Failed to get config directory"))?;
        
        Ok(config_dir.join("schaltwerk").join("project_history.json"))
    }
    
    pub fn add_project(&mut self, path: &str) -> Result<()> {
        let path_buf = PathBuf::from(path);
        let name = path_buf
            .file_name()
            .and_then(|n| n.to_str())
            .unwrap_or("Unknown")
            .to_string();
        
        let project = RecentProject {
            path: path.to_string(),
            name,
            last_opened: Utc::now().timestamp_millis(),
        };
        
        self.projects.insert(path.to_string(), project);
        self.save()?;
        Ok(())
    }
    
    pub fn update_timestamp(&mut self, path: &str) -> Result<()> {
        if let Some(project) = self.projects.get_mut(path) {
            project.last_opened = Utc::now().timestamp_millis();
            self.save()?;
        }
        Ok(())
    }
    
    pub fn remove_project(&mut self, path: &str) -> Result<()> {
        self.projects.remove(path);
        self.save()?;
        Ok(())
    }
    
    pub fn get_recent_projects(&self) -> Vec<RecentProject> {
        let mut projects: Vec<_> = self.projects.values().cloned().collect();
        projects.sort_by(|a, b| b.last_opened.cmp(&a.last_opened));
        projects.truncate(20);
        projects
    }
}

pub fn is_git_repository(path: &Path) -> bool {
    let git_dir = path.join(".git");
    git_dir.exists() && (git_dir.is_dir() || git_dir.is_file())
}

pub fn directory_exists(path: &Path) -> bool {
    path.exists() && path.is_dir()
}

pub fn create_new_project(name: &str, parent_path: &str) -> Result<PathBuf> {
    use std::fs;
    
    let parent = Path::new(parent_path);
    
    if !parent.exists() || !parent.is_dir() {
        return Err(anyhow::anyhow!("Parent directory does not exist: {}", parent_path));
    }
    
    let project_path = parent.join(name);
    
    if project_path.exists() {
        return Err(anyhow::anyhow!("Project directory already exists: {}", project_path.display()));
    }
    
    fs::create_dir(&project_path)
        .map_err(|e| anyhow::anyhow!("Failed to create project directory: {}", e))?;
    
    if let Err(e) = crate::schaltwerk_core::git::init_repository(&project_path) {
        fs::remove_dir(&project_path).ok();
        return Err(e);
    }
    
    let mut history = ProjectHistory::load()?;
    history.add_project(project_path.to_str()
        .ok_or_else(|| anyhow::anyhow!("Invalid path encoding"))?)?;
    
    log::info!("Created new project with git repository: {}", project_path.display());
    
    Ok(project_path)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;
    use std::env;

    #[test]
    #[serial_test::serial]
    fn test_project_history_add_update_remove_and_persist() {
        // Redirect HOME and XDG_CONFIG_HOME for cross-platform compatibility
        let tmp = TempDir::new().unwrap();
        let prev_home = env::var("HOME").ok();
        let prev_xdg = env::var("XDG_CONFIG_HOME").ok();
        
        // Set HOME for macOS and XDG_CONFIG_HOME for Linux
        env::set_var("HOME", tmp.path());
        env::set_var("XDG_CONFIG_HOME", tmp.path().join(".config"));
        
        // Ensure the config directory exists
        let config_path = tmp.path().join(".config");
        std::fs::create_dir_all(&config_path).unwrap();

        let mut hist = ProjectHistory::load().unwrap();
        assert_eq!(hist.get_recent_projects().len(), 0);

        hist.add_project("/a/b/c").unwrap();
        hist.add_project("/x/y").unwrap();
        let projects = hist.get_recent_projects();
        assert_eq!(projects.len(), 2);

        // Add a small delay to ensure timestamp difference
        std::thread::sleep(std::time::Duration::from_millis(10));
        
        // Update timestamp and ensure order changes (most recent first)
        hist.update_timestamp("/a/b/c").unwrap();
        let recent = hist.get_recent_projects();
        assert_eq!(recent[0].path, "/a/b/c");

        // Remove and persist
        hist.remove_project("/a/b/c").unwrap();
        let after_remove = ProjectHistory::load().unwrap();
        let list = after_remove.get_recent_projects();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].path, "/x/y");

        // Restore environment variables
        if let Some(p) = prev_home { env::set_var("HOME", p); } else { env::remove_var("HOME"); }
        if let Some(p) = prev_xdg { env::set_var("XDG_CONFIG_HOME", p); } else { env::remove_var("XDG_CONFIG_HOME"); }
    }

    #[test]
    fn test_is_git_repository_and_directory_exists() {
        let tmp = TempDir::new().unwrap();
        let root = tmp.path();

        // Initially no .git
        assert!(!is_git_repository(root));
        assert!(directory_exists(root));

        // Create bare .git dir
        std::fs::create_dir(root.join(".git")).unwrap();
        assert!(is_git_repository(root));
    }
}