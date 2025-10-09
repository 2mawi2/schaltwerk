use crate::project_manager::ProjectManager;
use async_trait::async_trait;
use std::path::PathBuf;
use std::sync::Arc;

#[async_trait]
pub trait ProjectsBackend: Send + Sync {
    async fn initialize_project(&self, path: PathBuf) -> Result<(), String>;
}

#[async_trait]
pub trait ProjectsService: Send + Sync {
    async fn initialize_project(&self, path: String) -> Result<(), String>;
}

pub struct ProjectsServiceImpl<B: ProjectsBackend> {
    backend: B,
}

impl<B: ProjectsBackend> ProjectsServiceImpl<B> {
    pub fn new(backend: B) -> Self {
        Self { backend }
    }

    pub async fn initialize_project(&self, path: String) -> Result<(), String> {
        log::info!("🔧 Initialize project command called with path: {path}");
        let path_buf = PathBuf::from(&path);

        if path_buf.exists() {
            log::info!("  Path exists: {}", path_buf.display());
            if path_buf.is_dir() {
                log::info!("  Path is a directory");
            } else {
                log::warn!("  Path is not a directory!");
            }

            if path_buf.join(".git").exists() {
                log::info!("  ✅ Git repository detected (.git folder exists)");
            } else {
                log::warn!("  ⚠️ No .git folder found - not a git repository");
            }
        } else {
            log::error!("  ❌ Path does not exist: {}", path_buf.display());
        }

        log::info!("Switching to project: {}", path_buf.display());
        let result = self
            .backend
            .initialize_project(path_buf.clone())
            .await
            .map_err(|err| {
                log::error!("Failed to initialize project: {err}");
                format!("Failed to initialize project: {err}")
            });

        if result.is_ok() {
            log::info!("✅ Project initialized successfully");
        }

        result
    }
}

#[async_trait]
impl<B> ProjectsService for ProjectsServiceImpl<B>
where
    B: ProjectsBackend + Sync,
{
    async fn initialize_project(&self, path: String) -> Result<(), String> {
        ProjectsServiceImpl::initialize_project(self, path).await
    }
}

pub struct ProjectManagerBackend {
    project_manager: Arc<ProjectManager>,
}

impl ProjectManagerBackend {
    pub fn new(project_manager: Arc<ProjectManager>) -> Self {
        Self { project_manager }
    }
}

#[async_trait]
impl ProjectsBackend for ProjectManagerBackend {
    async fn initialize_project(&self, path: PathBuf) -> Result<(), String> {
        self.project_manager
            .switch_to_project(path)
            .await
            .map(|_| ())
            .map_err(|err| err.to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use async_trait::async_trait;
    use std::sync::Arc;
    use tokio::sync::Mutex;

    struct RecordingBackend {
        paths: Arc<Mutex<Vec<PathBuf>>>,
    }

    #[async_trait]
    impl ProjectsBackend for RecordingBackend {
        async fn initialize_project(&self, path: PathBuf) -> Result<(), String> {
            self.paths.lock().await.push(path);
            Ok(())
        }
    }

    struct ErrorBackend;

    #[async_trait]
    impl ProjectsBackend for ErrorBackend {
        async fn initialize_project(&self, _path: PathBuf) -> Result<(), String> {
            Err("switch failed".to_string())
        }
    }

    #[tokio::test]
    async fn delegates_initialization() {
        let paths = Arc::new(Mutex::new(Vec::new()));
        let backend = RecordingBackend {
            paths: Arc::clone(&paths),
        };
        let service = ProjectsServiceImpl::new(backend);

        let result = service.initialize_project("/tmp/example".to_string()).await;
        assert!(result.is_ok(), "expected success from service: {result:?}");

        let recorded = paths.lock().await;
        assert_eq!(recorded.len(), 1);
        assert_eq!(recorded[0], PathBuf::from("/tmp/example"));
    }

    #[tokio::test]
    async fn wraps_backend_failures() {
        let service = ProjectsServiceImpl::new(ErrorBackend);
        let result = service.initialize_project("/tmp/failure".to_string()).await;
        assert!(result.is_err(), "expected error when backend fails");
        let message = result.unwrap_err();
        assert!(
            message.contains("switch failed"),
            "error should include backend cause: {message}"
        );
        assert!(
            message.contains("initialize project"),
            "error should include context: {message}"
        );
    }
}
