use std::process::Command;

use crate::errors::SchaltError;

#[cfg(target_os = "linux")]
pub mod linux;
#[cfg(target_os = "macos")]
pub mod macos;

#[cfg(target_os = "linux")]
pub use linux::LinuxAdapter as PlatformAdapterImpl;
#[cfg(target_os = "macos")]
pub use macos::MacOsAdapter as PlatformAdapterImpl;

pub trait PlatformAdapter: Send + Sync {
    /// Build the inhibitor command specific to the platform.
    fn build_command(&self) -> Result<Command, SchaltError>;

    /// Attempt to find an existing inhibitor process started by Schaltwerk.
    fn find_existing_inhibitor(&self) -> Result<Option<u32>, SchaltError>;
}

pub fn default_adapter() -> Result<PlatformAdapterImpl, SchaltError> {
    PlatformAdapterImpl::new()
}
