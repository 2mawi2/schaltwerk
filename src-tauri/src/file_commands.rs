use crate::diff_commands::resolve_repo_path_structured;
use crate::errors::SchaltError;
use schaltwerk::binary_detection::{is_binary_file_by_extension, is_likely_binary_content};
use schaltwerk::domains::workspace::diff_engine::get_file_language;

#[derive(serde::Serialize, Clone, Debug)]
pub struct FileContentResponse {
    pub content: String,
    pub is_binary: bool,
    pub size_bytes: usize,
    pub language: Option<String>,
}

const MAX_FILE_SIZE_FOR_VIEW: usize = 5 * 1024 * 1024;

#[tauri::command]
pub async fn read_project_file(
    session_name: Option<String>,
    file_path: String,
) -> Result<FileContentResponse, SchaltError> {
    let repo_path = resolve_repo_path_structured(session_name.as_deref()).await?;
    let full_path = std::path::Path::new(&repo_path).join(&file_path);

    if !full_path.exists() {
        return Err(SchaltError::invalid_input(
            "file_path",
            format!("File not found: {file_path}"),
        ));
    }

    let metadata = std::fs::metadata(&full_path).map_err(|e| {
        SchaltError::io("get_file_metadata", full_path.to_string_lossy(), e)
    })?;

    if metadata.is_dir() {
        return Err(SchaltError::invalid_input(
            "file_path",
            "Cannot read directory as file".to_string(),
        ));
    }

    let size = metadata.len() as usize;

    if size > MAX_FILE_SIZE_FOR_VIEW {
        return Ok(FileContentResponse {
            content: String::new(),
            is_binary: false,
            size_bytes: size,
            language: get_file_language(&file_path),
        });
    }

    if is_binary_file_by_extension(&file_path) {
        return Ok(FileContentResponse {
            content: String::new(),
            is_binary: true,
            size_bytes: size,
            language: None,
        });
    }

    let bytes = std::fs::read(&full_path)
        .map_err(|e| SchaltError::io("read_file", full_path.to_string_lossy(), e))?;

    if is_likely_binary_content(&bytes) {
        return Ok(FileContentResponse {
            content: String::new(),
            is_binary: true,
            size_bytes: size,
            language: None,
        });
    }

    let content = String::from_utf8_lossy(&bytes).to_string();

    Ok(FileContentResponse {
        content,
        is_binary: false,
        size_bytes: size,
        language: get_file_language(&file_path),
    })
}
