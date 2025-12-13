use super::SessionManager;
use crate::domains::git::service as git;
use crate::domains::sessions::entity::Epic;
use anyhow::{Result, anyhow};
use uuid::Uuid;

impl SessionManager {
    pub fn list_epics(&self) -> Result<Vec<Epic>> {
        self.db_manager.list_epics()
    }

    pub fn get_epic_by_id(&self, id: &str) -> Result<Epic> {
        self.db_manager.get_epic_by_id(id)
    }

    pub fn create_epic(&self, name: &str, color: Option<&str>) -> Result<Epic> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(anyhow!("Epic name is required"));
        }
        if !git::is_valid_session_name(trimmed) {
            return Err(anyhow!(
                "Invalid epic name: use only letters, numbers, hyphens, and underscores"
            ));
        }

        if self.db_manager.get_epic_by_name(trimmed).is_ok() {
            return Err(anyhow!("Epic '{trimmed}' already exists"));
        }

        let epic = Epic {
            id: Uuid::new_v4().to_string(),
            name: trimmed.to_string(),
            color: color.map(|value| value.to_string()),
        };

        self.db_manager.create_epic(&epic)?;
        Ok(epic)
    }

    pub fn update_epic(&self, id: &str, name: &str, color: Option<&str>) -> Result<Epic> {
        let trimmed = name.trim();
        if trimmed.is_empty() {
            return Err(anyhow!("Epic name is required"));
        }
        if !git::is_valid_session_name(trimmed) {
            return Err(anyhow!(
                "Invalid epic name: use only letters, numbers, hyphens, and underscores"
            ));
        }

        if let Ok(existing) = self.db_manager.get_epic_by_name(trimmed) && existing.id != id {
            return Err(anyhow!("Epic '{trimmed}' already exists"));
        }

        self.db_manager.update_epic(id, trimmed, color)?;
        self.db_manager.get_epic_by_id(id)
    }

    pub fn delete_epic(&self, id: &str) -> Result<()> {
        self.db_manager.clear_epic_assignments(id)?;
        self.db_manager.delete_epic(id)?;
        Ok(())
    }

    pub fn set_item_epic(&self, name: &str, epic_id: Option<&str>) -> Result<()> {
        if let Some(epic_id) = epic_id {
            self.db_manager.get_epic_by_id(epic_id)?;
        }

        if let Ok(session) = self.db_manager.get_session_by_name(name) {
            self.db_manager
                .update_session_epic_id(&session.id, epic_id)?;
            return Ok(());
        }

        let spec = self.db_manager.get_spec_by_name(name)?;
        self.db_manager.update_spec_epic_id(&spec.id, epic_id)?;
        Ok(())
    }
}

