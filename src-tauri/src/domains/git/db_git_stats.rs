use rusqlite::params;
use anyhow::Result;
use chrono::{Utc, TimeZone};
use crate::infrastructure::database::connection::Database;
use crate::domains::sessions::entity::GitStats;

pub trait GitStatsMethods {
    fn save_git_stats(&self, stats: &GitStats) -> Result<()>;
    fn get_git_stats(&self, session_id: &str) -> Result<Option<GitStats>>;
    fn should_update_stats(&self, session_id: &str) -> Result<bool>;
}

impl GitStatsMethods for Database {
    fn save_git_stats(&self, stats: &GitStats) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        
        conn.execute(
            "INSERT OR REPLACE INTO git_stats
             (session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                stats.session_id,
                stats.files_changed,
                stats.lines_added,
                stats.lines_removed,
                stats.has_uncommitted,
                stats.calculated_at.timestamp(),
            ],
        )?;
        
        Ok(())
    }
    
    fn get_git_stats(&self, session_id: &str) -> Result<Option<GitStats>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT session_id, files_changed, lines_added, lines_removed, has_uncommitted, calculated_at
             FROM git_stats WHERE session_id = ?1",
        )?;
        let result: rusqlite::Result<GitStats> = stmt.query_row(params![session_id], |row| {
            Ok(GitStats {
                session_id: row.get(0)?,
                files_changed: row.get(1)?,
                lines_added: row.get(2)?,
                lines_removed: row.get(3)?,
                has_uncommitted: row.get(4)?,
                calculated_at: Utc.timestamp_opt(row.get(5)?, 0).unwrap(),
                last_diff_change_ts: None,
            })
        });
        match result {
            Ok(stats) => Ok(Some(stats)),
            Err(_) => Ok(None),
        }
    }

    
    fn should_update_stats(&self, session_id: &str) -> Result<bool> {
        let conn = self.conn.lock().unwrap();
        
        let result: rusqlite::Result<i64> = conn.query_row(
            "SELECT calculated_at FROM git_stats WHERE session_id = ?1",
            params![session_id],
            |row| row.get(0),
        );
        
        match result {
            Ok(last_calculated) => {
                let now = Utc::now().timestamp();
                Ok(now - last_calculated > 60)
            }
            Err(_) => Ok(true),
        }
    }
}