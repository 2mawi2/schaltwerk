use log::info;
#[cfg(test)]
use std::sync::atomic::{AtomicBool, Ordering};

#[cfg(test)]
static TEST_CLEANUP_CALLED: AtomicBool = AtomicBool::new(false);

/// Cleanup all running terminals
pub async fn cleanup_all_terminals() {
    info!("Emergency cleanup (panic/unexpected exit)");
    #[cfg(test)]
    TEST_CLEANUP_CALLED.store(true, Ordering::SeqCst);

    // Use force kill for speed even in emergency scenarios
    if let Some(manager) = crate::PROJECT_MANAGER.get() {
        manager.force_kill_all().await;
    }

    info!("Emergency cleanup complete");
}

/// Ensure cleanup happens even on panic
pub struct TerminalCleanupGuard;

impl Drop for TerminalCleanupGuard {
    fn drop(&mut self) {
        // Prefer a blocking cleanup so terminals are actually killed during shutdown.
        if let Ok(handle) = tokio::runtime::Handle::try_current() {
            handle.block_on(async { cleanup_all_terminals().await });
        } else if let Ok(rt) = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .build()
        {
            rt.block_on(async { cleanup_all_terminals().await });
        } else {
            // Last-resort best effort: fire-and-forget.
            tauri::async_runtime::spawn(async {
                cleanup_all_terminals().await;
            });
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_cleanup_with_no_terminals() {
        // Should not panic when no terminals exist
        cleanup_all_terminals().await;
    }

    #[test]
    fn test_cleanup_guard_drop() {
        TEST_CLEANUP_CALLED.store(false, Ordering::SeqCst);
        {
            let _guard = TerminalCleanupGuard;
            // Guard will be dropped here
        }
        assert!(
            TEST_CLEANUP_CALLED.load(Ordering::SeqCst),
            "cleanup should be invoked when guard drops"
        );
    }
}
