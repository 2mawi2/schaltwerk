use rusqlite::params;
use anyhow::Result;
use crate::schaltwerk_core::database::Database;

pub trait AppConfigMethods {
    fn get_skip_permissions(&self) -> Result<bool>;
    fn set_skip_permissions(&self, enabled: bool) -> Result<()>;
    fn get_agent_type(&self) -> Result<String>;
    fn set_agent_type(&self, agent_type: &str) -> Result<()>;
    fn get_font_sizes(&self) -> Result<(i32, i32)>;
    fn set_font_sizes(&self, terminal_font_size: i32, ui_font_size: i32) -> Result<()>;
    fn get_default_base_branch(&self) -> Result<Option<String>>;
    fn set_default_base_branch(&self, branch: Option<&str>) -> Result<()>;
    fn get_default_open_app(&self) -> Result<String>;
    fn set_default_open_app(&self, app_id: &str) -> Result<()>;
}

impl AppConfigMethods for Database {
    fn get_skip_permissions(&self) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        
        let result: rusqlite::Result<bool> = conn.query_row(
            "SELECT skip_permissions FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok(false),
        }
    }
    
    fn set_skip_permissions(&self, enabled: bool) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET skip_permissions = ?1 WHERE id = 1",
            params![enabled],
        )?;
        
        Ok(())
    }
    
    fn get_agent_type(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT agent_type FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok("claude".to_string()),
        }
    }
    
    fn set_agent_type(&self, agent_type: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET agent_type = ?1 WHERE id = 1",
            params![agent_type],
        )?;
        
        Ok(())
    }
    
    fn get_font_sizes(&self) -> Result<(i32, i32)> {
        let conn = self.conn.lock().unwrap();
        
        // Try new columns first
        let result: rusqlite::Result<(i32, i32)> = conn.query_row(
            "SELECT terminal_font_size, ui_font_size FROM app_config WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => {
                // Fallback to old font_size column if new ones don't exist
                let old_result: rusqlite::Result<i32> = conn.query_row(
                    "SELECT font_size FROM app_config WHERE id = 1",
                    [],
                    |row| row.get(0),
                );
                
                match old_result {
                    Ok(size) => {
                        let ui_size = if size == 13 { 12 } else { size - 1 };
                        Ok((size, ui_size))
                    },
                    Err(_) => Ok((13, 12)),
                }
            }
        }
    }
    
    fn set_font_sizes(&self, terminal_font_size: i32, ui_font_size: i32) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET terminal_font_size = ?1, ui_font_size = ?2 WHERE id = 1",
            params![terminal_font_size, ui_font_size],
        )?;
        
        Ok(())
    }
    
    fn get_default_base_branch(&self) -> Result<Option<String>> {
        let conn = self.conn.lock().unwrap();
        
        let result: rusqlite::Result<Option<String>> = conn.query_row(
            "SELECT default_base_branch FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok(None),
        }
    }
    
    fn set_default_base_branch(&self, branch: Option<&str>) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "UPDATE app_config SET default_base_branch = ?1 WHERE id = 1",
            params![branch],
        )?;
        
        Ok(())
    }

    fn get_default_open_app(&self) -> Result<String> {
        let conn = self.conn.lock().unwrap();
        let result: rusqlite::Result<String> = conn.query_row(
            "SELECT default_open_app FROM app_config WHERE id = 1",
            [],
            |row| row.get(0),
        );
        match result {
            Ok(value) => Ok(value),
            Err(_) => Ok("finder".to_string()),
        }
    }

    fn set_default_open_app(&self, app_id: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE app_config SET default_open_app = ?1 WHERE id = 1",
            params![app_id],
        )?;
        Ok(())
    }
}