use rusqlite::Connection;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use anyhow::Result;

// Import the db_schema module
use crate::schaltwerk_core::db_schema;





#[derive(Clone)]
pub struct Database {
    pub(crate) conn: Arc<Mutex<Connection>>,
    #[allow(dead_code)]
    pub(crate) db_path: PathBuf,
}

impl Database {
    pub fn new(db_path: Option<PathBuf>) -> Result<Self> {
        let path = db_path.unwrap_or_else(|| {
            dirs::data_local_dir()
                .unwrap()
                .join("schaltwerk")
                .join("sessions.db")
        });
        
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        
        let conn = Connection::open(&path)?;
        
        let db = Self {
            conn: Arc::new(Mutex::new(conn)),
            db_path: path,
        };
        
        db.initialize_schema()?;
        
        Ok(db)
    }
    
    fn initialize_schema(&self) -> Result<()> {
        db_schema::initialize_schema(self)
    }
}