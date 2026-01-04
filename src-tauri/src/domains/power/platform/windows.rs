use std::process::Command;

use crate::errors::SchaltError;

use super::PlatformAdapter;

pub struct WindowsAdapter;

impl WindowsAdapter {
    pub fn new() -> Result<Self, SchaltError> {
        Ok(Self)
    }
}

impl PlatformAdapter for WindowsAdapter {
    fn build_command(&self) -> Result<Command, SchaltError> {
        Err(SchaltError::NotSupported {
            feature: "keep-awake".to_string(),
            platform: "windows".to_string(),
        })
    }

    fn find_existing_inhibitor(&self) -> Result<Option<u32>, SchaltError> {
        Ok(None)
    }
}
