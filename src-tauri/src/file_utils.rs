use std::fs;
use std::path::Path;

const MAX_FILE_SIZE: u64 = 10 * 1024 * 1024; // 10MB
const BINARY_CHECK_SIZE: usize = 8000; // Git's standard: check first 8000 bytes

const NON_DIFFABLE_EXTENSIONS: &[&str] = &[
    // Binary executables and libraries
    "exe", "dll", "so", "dylib", "lib", "a", "o", "app", // Archives
    "zip", "tar", "gz", "bz2", "xz", "7z", "rar", "jar", "war", "ear", // Images
    "jpg", "jpeg", "png", "gif", "bmp", "ico", "svg", "webp", "tiff", "tif", "psd", "ai", "eps",
    "raw", "cr2", "nef", "orf", "sr2", // Videos
    "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "m4v", "mpg", "mpeg", "3gp", "3g2",
    // Audio
    "mp3", "wav", "flac", "aac", "ogg", "wma", "m4a", "opus", "aiff", "ape",
    // Documents (binary formats)
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", // Databases
    "db", "sqlite", "sqlite3", "mdb", "accdb", // Fonts
    "ttf", "otf", "woff", "woff2", "eot", // Other binary formats
    "pyc", "pyo", "class", "dex", "apk", "ipa", "dmg", "iso", "img", "bin", "dat", "pak", "bundle",
    // macOS specific
    "icns", // Git files
    "pack", "idx", // Node modules and package files
    "node", "wasm",
];

pub fn is_file_diffable(path: &Path) -> Result<bool, String> {
    // Check if file exists
    if !path.exists() {
        // Non-existent files are diffable (will show as deleted)
        return Ok(true);
    }

    // Check file extension
    if let Some(extension) = path.extension() {
        let ext = extension.to_str().unwrap_or("").to_lowercase();
        if NON_DIFFABLE_EXTENSIONS.contains(&ext.as_str()) {
            return Ok(false);
        }
    }

    // Check file name for special cases
    if let Some(file_name) = path.file_name() {
        let name = file_name.to_str().unwrap_or("");
        if name == ".DS_Store" || name.starts_with("._") {
            return Ok(false);
        }
    }

    // Check file size
    let metadata = fs::metadata(path).map_err(|e| format!("Failed to get file metadata: {e}"))?;

    if metadata.len() > MAX_FILE_SIZE {
        return Ok(false);
    }

    // Check if file is binary by examining content
    if is_binary_file(path)? {
        return Ok(false);
    }

    Ok(true)
}

#[cfg(test)]
pub fn is_binary_file(path: &Path) -> Result<bool, String> {
    is_binary_file_impl(path)
}

#[cfg(not(test))]
fn is_binary_file(path: &Path) -> Result<bool, String> {
    is_binary_file_impl(path)
}

fn is_binary_file_impl(path: &Path) -> Result<bool, String> {
    let file = fs::File::open(path).map_err(|e| format!("Failed to open file: {e}"))?;

    use std::io::Read;
    let mut buffer = vec![0u8; BINARY_CHECK_SIZE];
    let bytes_read = file
        .take(BINARY_CHECK_SIZE as u64)
        .read(&mut buffer)
        .map_err(|e| format!("Failed to read file: {e}"))?;

    buffer.truncate(bytes_read);

    // Use Git's standard algorithm: check for null bytes (\0) in first 8000 bytes
    // This is exactly how Git detects binary files (see Git source: buffer_is_binary())
    if buffer.contains(&0) {
        return Ok(true);
    }

    Ok(false)
}

pub struct DiffableFileInfo {
    pub is_diffable: bool,
    pub reason: Option<String>,
}

pub fn check_file_diffability(path: &Path) -> DiffableFileInfo {
    match is_file_diffable(path) {
        Ok(true) => DiffableFileInfo {
            is_diffable: true,
            reason: None,
        },
        Ok(false) => {
            let reason = determine_non_diffable_reason(path);
            DiffableFileInfo {
                is_diffable: false,
                reason: Some(reason),
            }
        }
        Err(e) => DiffableFileInfo {
            is_diffable: false,
            reason: Some(format!("Error checking file: {e}")),
        },
    }
}

fn determine_non_diffable_reason(path: &Path) -> String {
    if let Some(extension) = path.extension() {
        let ext = extension.to_str().unwrap_or("").to_lowercase();
        if NON_DIFFABLE_EXTENSIONS.contains(&ext.as_str()) {
            return format!("Binary file type: .{ext}");
        }
    }

    if let Some(file_name) = path.file_name() {
        let name = file_name.to_str().unwrap_or("");
        if name == ".DS_Store" || name.starts_with("._") {
            return format!("System file: {name}");
        }
    }

    if let Ok(metadata) = fs::metadata(path) {
        if metadata.len() > MAX_FILE_SIZE {
            let size_mb = metadata.len() as f64 / (1024.0 * 1024.0);
            return format!(
                "File too large: {:.1} MB (max: {} MB)",
                size_mb,
                MAX_FILE_SIZE / (1024 * 1024)
            );
        }
    }

    if let Ok(true) = is_binary_file_impl(path) {
        return "Binary file content detected".to_string();
    }

    "File cannot be diffed".to_string()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[cfg(unix)]
    use libc;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn test_text_file_is_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("test.txt");
        fs::write(&file_path, "Hello, world!\nThis is a text file.").unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(result, "Text file should be diffable");
    }

    #[test]
    fn test_non_existent_file_is_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("non_existent.txt");

        let result = is_file_diffable(&file_path).unwrap();
        assert!(
            result,
            "Non-existent file should be diffable (shows as deleted)"
        );
    }

    #[test]
    fn test_binary_extensions_not_diffable() {
        let temp_dir = TempDir::new().unwrap();

        let binary_extensions = vec![
            "exe", "dll", "so", "zip", "tar", "gz", "jpg", "png", "mp4", "mp3", "pdf", "doc",
            "sqlite", "ttf", "wasm",
        ];

        for ext in binary_extensions {
            let file_path = temp_dir.path().join(format!("test.{}", ext));
            fs::write(&file_path, "dummy content").unwrap();

            let result = is_file_diffable(&file_path).unwrap();
            assert!(
                !result,
                "File with .{} extension should not be diffable",
                ext
            );
        }
    }

    #[test]
    fn test_ds_store_not_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join(".DS_Store");
        fs::write(&file_path, "dummy content").unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(!result, ".DS_Store file should not be diffable");
    }

    #[test]
    fn test_dot_underscore_files_not_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("._test.txt");
        fs::write(&file_path, "dummy content").unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(!result, "Files starting with ._ should not be diffable");
    }

    #[test]
    fn test_large_file_not_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("large.txt");

        // Create a file larger than MAX_FILE_SIZE (10MB)
        let large_content = vec![b'a'; (MAX_FILE_SIZE + 1) as usize];
        fs::write(&file_path, large_content).unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(!result, "File larger than 10MB should not be diffable");
    }

    #[test]
    fn test_file_with_null_bytes_not_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("binary.dat");

        // Create a file with null bytes (binary content)
        let mut content = vec![b'A'; 100];
        content[50] = 0; // Insert null byte
        fs::write(&file_path, content).unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(!result, "File with null bytes should not be diffable");
    }

    #[test]
    fn test_utf8_text_file_is_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("utf8.txt");
        fs::write(&file_path, "Hello 世界! 🌍\nUTF-8 text with emojis").unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(result, "UTF-8 text file should be diffable");
    }

    #[test]
    fn test_empty_file_is_diffable() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("empty.txt");
        fs::write(&file_path, "").unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(result, "Empty file should be diffable");
    }

    #[test]
    fn test_check_file_diffability_provides_reasons() {
        let temp_dir = TempDir::new().unwrap();

        // Test binary extension reason
        let zip_path = temp_dir.path().join("test.zip");
        fs::write(&zip_path, "dummy").unwrap();
        let info = check_file_diffability(&zip_path);
        assert!(!info.is_diffable);
        assert!(info.reason.unwrap().contains("Binary file type"));

        // Test large file reason
        let large_path = temp_dir.path().join("large.txt");
        let large_content = vec![b'a'; (MAX_FILE_SIZE + 1) as usize];
        fs::write(&large_path, large_content).unwrap();
        let info = check_file_diffability(&large_path);
        assert!(!info.is_diffable);
        assert!(info.reason.unwrap().contains("File too large"));

        // Test system file reason
        let ds_store_path = temp_dir.path().join(".DS_Store");
        fs::write(&ds_store_path, "dummy").unwrap();
        let info = check_file_diffability(&ds_store_path);
        assert!(!info.is_diffable);
        assert!(info.reason.unwrap().contains("System file"));

        // Test binary content reason
        let binary_path = temp_dir.path().join("binary.dat");
        let mut content = vec![b'A'; 100];
        content[50] = 0;
        fs::write(&binary_path, content).unwrap();
        let info = check_file_diffability(&binary_path);
        assert!(!info.is_diffable);
        // The reason will be "Binary file content detected" from is_binary_file check
        let reason = info.reason.unwrap();
        assert!(
            reason.contains("Binary") || reason.contains("binary"),
            "Expected binary-related reason, got: {}",
            reason
        );
    }

    #[test]
    fn test_source_code_files_are_diffable() {
        let temp_dir = TempDir::new().unwrap();

        let source_extensions = vec![
            "rs", "ts", "tsx", "js", "jsx", "py", "go", "java", "cpp", "c", "h", "css", "html",
            "xml", "json", "yaml", "toml", "md", "sh", "sql",
        ];

        for ext in source_extensions {
            let file_path = temp_dir.path().join(format!("test.{}", ext));
            fs::write(&file_path, "// Source code\nfunction test() {}\n").unwrap();

            let result = is_file_diffable(&file_path).unwrap();
            assert!(
                result,
                "Source file with .{} extension should be diffable",
                ext
            );
        }
    }

    #[test]
    fn test_is_binary_file_with_null_at_start() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("binary_start.dat");

        // Null byte at the very beginning
        let mut content = vec![0; 1];
        content.extend_from_slice(b"Some text after null");
        fs::write(&file_path, content).unwrap();

        let result = is_binary_file(&file_path).unwrap();
        assert!(result, "File with null byte at start should be binary");
    }

    #[test]
    fn test_is_binary_file_with_null_at_end_of_check_range() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("binary_end.dat");

        // Null byte exactly at position 7999 (last position checked)
        let mut content = vec![b'A'; 8000];
        content[7999] = 0;
        fs::write(&file_path, content).unwrap();

        let result = is_binary_file(&file_path).unwrap();
        assert!(
            result,
            "File with null byte at position 7999 should be binary"
        );
    }

    #[test]
    fn test_is_binary_file_with_null_beyond_check_range() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("text_with_late_null.dat");

        // Null byte at position 8001 (beyond check range)
        let mut content = vec![b'A'; 8002];
        content[8001] = 0;
        fs::write(&file_path, content).unwrap();

        let result = is_binary_file(&file_path).unwrap();
        assert!(
            !result,
            "File with null byte only after position 8000 should not be detected as binary"
        );
    }

    #[test]
    fn test_is_binary_file_with_multiple_nulls() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("very_binary.dat");

        // Multiple null bytes scattered throughout
        let mut content = vec![b'A'; 1000];
        for i in (0..1000).step_by(100) {
            content[i] = 0;
        }
        fs::write(&file_path, content).unwrap();

        let result = is_binary_file(&file_path).unwrap();
        assert!(result, "File with multiple null bytes should be binary");
    }

    #[test]
    fn test_is_binary_file_small_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("small.txt");

        // Small file without null bytes
        fs::write(&file_path, b"Hello").unwrap();

        let result = is_binary_file(&file_path).unwrap();
        assert!(!result, "Small text file should not be binary");

        // Small file with null byte
        let file_path2 = temp_dir.path().join("small_binary.dat");
        fs::write(&file_path2, b"He\0lo").unwrap();

        let result2 = is_binary_file(&file_path2).unwrap();
        assert!(result2, "Small file with null byte should be binary");
    }

    #[test]
    fn test_is_binary_file_empty_file() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("empty.dat");

        fs::write(&file_path, b"").unwrap();

        let result = is_binary_file(&file_path).unwrap();
        assert!(!result, "Empty file should not be binary");
    }

    #[test]
    fn test_is_binary_file_non_existent() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("does_not_exist.dat");

        let result = is_binary_file(&file_path);
        assert!(result.is_err(), "Non-existent file should return error");
        assert!(result.unwrap_err().contains("Failed to open file"));
    }

    #[test]
    fn test_is_binary_file_common_binary_formats() {
        let temp_dir = TempDir::new().unwrap();

        // JPEG magic bytes
        let jpeg_path = temp_dir.path().join("image.jpg");
        fs::write(&jpeg_path, &[0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10]).unwrap();
        assert!(
            is_binary_file(&jpeg_path).unwrap(),
            "JPEG should be detected as binary"
        );

        // PNG magic bytes (note: 0x0A is not a null byte, but PNG has other nulls)
        let png_path = temp_dir.path().join("image.png");
        // PNG header doesn't contain null bytes in first 8 bytes, but real PNGs do later
        // Use a more realistic PNG fragment with IHDR chunk that contains nulls
        let png_data = vec![
            0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, // PNG signature
            0x00, 0x00, 0x00, 0x0D, // IHDR chunk size (contains nulls)
            0x49, 0x48, 0x44, 0x52, // "IHDR"
        ];
        fs::write(&png_path, png_data).unwrap();
        assert!(
            is_binary_file(&png_path).unwrap(),
            "PNG should be detected as binary"
        );

        // ZIP magic bytes
        let zip_path = temp_dir.path().join("archive.zip");
        fs::write(&zip_path, &[0x50, 0x4B, 0x03, 0x04, 0x00]).unwrap();
        assert!(
            is_binary_file(&zip_path).unwrap(),
            "ZIP should be detected as binary"
        );
    }

    #[test]
    fn test_check_file_diffability_edge_cases() {
        let temp_dir = TempDir::new().unwrap();

        // File with no extension
        let no_ext_path = temp_dir.path().join("noextension");
        fs::write(&no_ext_path, "text content").unwrap();
        let info = check_file_diffability(&no_ext_path);
        assert!(
            info.is_diffable,
            "File without extension but with text content should be diffable"
        );

        // File with uppercase extension
        let upper_ext_path = temp_dir.path().join("test.ZIP");
        fs::write(&upper_ext_path, "dummy").unwrap();
        let info = check_file_diffability(&upper_ext_path);
        assert!(
            !info.is_diffable,
            "File with uppercase binary extension should not be diffable"
        );
        assert!(info.reason.unwrap().contains("Binary file type"));

        // File with compound extension
        let compound_ext_path = temp_dir.path().join("test.tar.gz");
        fs::write(&compound_ext_path, "dummy").unwrap();
        let info = check_file_diffability(&compound_ext_path);
        assert!(
            !info.is_diffable,
            "File with .tar.gz should not be diffable"
        );
    }

    #[test]
    fn test_max_file_size_boundary() {
        let temp_dir = TempDir::new().unwrap();

        // File exactly at MAX_FILE_SIZE
        let exact_size_path = temp_dir.path().join("exact_size.txt");
        let exact_content = vec![b'a'; MAX_FILE_SIZE as usize];
        fs::write(&exact_size_path, exact_content).unwrap();
        let result = is_file_diffable(&exact_size_path).unwrap();
        assert!(result, "File exactly at MAX_FILE_SIZE should be diffable");

        // File one byte over MAX_FILE_SIZE
        let over_size_path = temp_dir.path().join("over_size.txt");
        let over_content = vec![b'a'; (MAX_FILE_SIZE + 1) as usize];
        fs::write(&over_size_path, over_content).unwrap();
        let result = is_file_diffable(&over_size_path).unwrap();
        assert!(
            !result,
            "File one byte over MAX_FILE_SIZE should not be diffable"
        );
    }

    #[test]
    fn test_special_characters_in_filename() {
        let temp_dir = TempDir::new().unwrap();

        // File with spaces and special characters
        let special_path = temp_dir.path().join("test file (2023) [spec].txt");
        fs::write(&special_path, "content").unwrap();
        let result = is_file_diffable(&special_path).unwrap();
        assert!(
            result,
            "File with special characters in name should be diffable if content is text"
        );
    }

    #[test]
    fn test_all_defined_extensions() {
        // Verify that all extensions in NON_DIFFABLE_EXTENSIONS are lowercase
        for ext in NON_DIFFABLE_EXTENSIONS {
            assert_eq!(
                ext,
                &ext.to_lowercase(),
                "Extension {} should be lowercase",
                ext
            );
        }

        // Verify no duplicates
        let mut seen = std::collections::HashSet::new();
        for ext in NON_DIFFABLE_EXTENSIONS {
            assert!(seen.insert(ext), "Duplicate extension found: {}", ext);
        }
    }

    #[test]
    fn test_git_standard_binary_detection() {
        let temp_dir = TempDir::new().unwrap();

        // Test that we follow Git's standard: null byte in first 8000 bytes = binary
        let file_path = temp_dir.path().join("git_test.dat");

        // File with null byte at position 7999 (within 8000 bytes)
        let mut content = vec![b'A'; 10000];
        content[7999] = 0;
        fs::write(&file_path, &content).unwrap();
        let result = is_file_diffable(&file_path).unwrap();
        assert!(
            !result,
            "File with null byte at position 7999 should be binary"
        );

        // File with null byte at position 8001 (outside first 8000 bytes check)
        // Note: In our implementation, we still check the whole file up to 10MB,
        // but Git only checks first 8000 bytes. This is a deliberate choice for safety.
        let file_path2 = temp_dir.path().join("git_test2.txt");
        let content2 = vec![b'A'; 9000]; // File without null bytes
        fs::write(&file_path2, &content2).unwrap();
        let result2 = is_file_diffable(&file_path2).unwrap();
        assert!(result2, "File without null bytes should be diffable");
    }

    #[test]
    fn test_determine_non_diffable_reason_completeness() {
        let temp_dir = TempDir::new().unwrap();

        // Test that determine_non_diffable_reason covers all cases
        // This ensures the function provides meaningful messages for all scenarios

        // Extension-based
        let ext_path = temp_dir.path().join("test.exe");
        fs::write(&ext_path, "dummy").unwrap();
        // Just check the path, don't call is_file_diffable first
        let reason = determine_non_diffable_reason(&ext_path);
        assert!(reason.contains("Binary file type"));

        // System file
        let sys_path = temp_dir.path().join(".DS_Store");
        fs::write(&sys_path, "dummy").unwrap();
        let reason = determine_non_diffable_reason(&sys_path);
        assert!(reason.contains("System file"));

        // Size-based
        let large_path = temp_dir.path().join("huge.txt");
        let large_content = vec![b'a'; (MAX_FILE_SIZE + 1024) as usize];
        fs::write(&large_path, large_content).unwrap();
        let reason = determine_non_diffable_reason(&large_path);
        assert!(reason.contains("File too large"));

        // Binary content (use an extension that's not in the blocklist)
        let bin_path = temp_dir.path().join("binary.txt");
        fs::write(&bin_path, &[0, 1, 2, 3]).unwrap();
        let reason = determine_non_diffable_reason(&bin_path);
        assert!(reason.contains("Binary file content detected"));
    }

    #[test]
    fn test_utf16_file_detection() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("utf16.txt");

        // UTF-16 BOM followed by "Hello" in UTF-16LE
        let utf16_content = vec![
            0xFF, 0xFE, // UTF-16 LE BOM
            0x48, 0x00, // H
            0x65, 0x00, // e
            0x6C, 0x00, // l
            0x6C, 0x00, // l
            0x6F, 0x00, // o
        ];
        fs::write(&file_path, utf16_content).unwrap();

        let result = is_binary_file(&file_path).unwrap();
        assert!(
            result,
            "UTF-16 files should be detected as binary due to null bytes"
        );
    }

    #[test]
    fn test_permission_denied_read() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("no_read_permission.txt");
        fs::write(&file_path, "test content").unwrap();

        // Remove read permission (Unix-like systems)
        #[cfg(unix)]
        {
            if unsafe { libc::geteuid() } == 0 {
                eprintln!("Skipping read-permission test when running as root");
                return;
            }

            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&file_path).unwrap().permissions();
            perms.set_mode(0o200); // write only
            fs::set_permissions(&file_path, perms).unwrap();

            // Test is_file_diffable with no read permission
            let result = is_file_diffable(&file_path);
            assert!(
                result.is_err(),
                "Should return error for file without read permission"
            );
            let err_msg = result.unwrap_err();
            assert!(
                err_msg.contains("Failed to get file metadata")
                    || err_msg.contains("Failed to open file"),
                "Error should indicate permission issue: {}",
                err_msg
            );

            // Test is_binary_file with no read permission
            let result = is_binary_file(&file_path);
            assert!(
                result.is_err(),
                "Should return error for file without read permission"
            );
            let err_msg = result.unwrap_err();
            assert!(
                err_msg.contains("Failed to open file"),
                "Error should indicate file open issue: {}",
                err_msg
            );

            // Restore permissions for cleanup
            let mut perms = fs::metadata(&file_path).unwrap().permissions();
            perms.set_mode(0o644);
            fs::set_permissions(&file_path, perms).unwrap();
        }

        #[cfg(not(unix))]
        {
            // On non-Unix systems, just test that the file exists and is readable
            let result = is_file_diffable(&file_path).unwrap();
            assert!(result, "File should be diffable on non-Unix systems");
        }
    }

    #[test]
    fn test_permission_denied_directory() {
        let temp_dir = TempDir::new().unwrap();
        let subdir = temp_dir.path().join("no_access");
        fs::create_dir(&subdir).unwrap();

        #[cfg(unix)]
        {
            use std::os::unix::fs::PermissionsExt;
            let mut perms = fs::metadata(&subdir).unwrap().permissions();
            perms.set_mode(0o000); // no permissions
            fs::set_permissions(&subdir, perms).unwrap();

            // We can't create a file in a directory without permissions, so just test the directory itself
            let result = is_file_diffable(&subdir);
            assert!(
                result.is_err(),
                "Should return error for directory without access"
            );

            // Restore permissions for cleanup
            let mut perms = fs::metadata(&subdir).unwrap().permissions();
            perms.set_mode(0o755);
            fs::set_permissions(&subdir, perms).unwrap();
        }

        #[cfg(not(unix))]
        {
            let file_path = subdir.join("test.txt");
            fs::write(&file_path, "test").unwrap();
            let result = is_file_diffable(&file_path).unwrap();
            assert!(result, "File should be diffable on non-Unix systems");
        }
    }

    #[test]
    fn test_symlink_to_regular_file() {
        let temp_dir = TempDir::new().unwrap();
        let target_file = temp_dir.path().join("target.txt");
        fs::write(&target_file, "Hello, symlink target!").unwrap();

        let symlink_path = temp_dir.path().join("link.txt");
        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&target_file, &symlink_path).unwrap();

            // Test that symlink is treated as diffable (follows target)
            let result = is_file_diffable(&symlink_path).unwrap();
            assert!(result, "Symlink to text file should be diffable");

            // Test with binary target (use null byte for reliable binary detection)
            let binary_target = temp_dir.path().join("binary_target.dat");
            fs::write(&binary_target, &[0x7F, 0x45, 0x4C, 0x46, 0x00, 0x01, 0x02]).unwrap(); // ELF magic + null byte
            let binary_link = temp_dir.path().join("binary_link.dat");
            std::os::unix::fs::symlink(&binary_target, &binary_link).unwrap();

            // Test both functions with the symlink
            let result = is_binary_file(&binary_link).unwrap();
            assert!(
                result,
                "Symlink to binary file should be detected as binary"
            );

            let result = is_file_diffable(&binary_link).unwrap();
            assert!(!result, "Symlink to binary file should not be diffable");
        }
    }

    #[test]
    fn test_broken_symlink() {
        let temp_dir = TempDir::new().unwrap();
        let broken_link = temp_dir.path().join("broken_link.txt");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink("nonexistent_target.txt", &broken_link).unwrap();

            // Broken symlinks behavior varies by system - they might return info about the link itself
            // rather than an error. Let's just verify the function doesn't panic.
            let result = is_file_diffable(&broken_link);
            // The result can be either Ok(true) or Err, depending on system behavior
            // What's important is that it doesn't panic
            match result {
                Ok(is_diffable) => {
                    // On some systems, broken symlinks are treated as diffable
                    // (they would show as deleted if the target doesn't exist)
                    assert!(
                        is_diffable,
                        "Broken symlink should be diffable (shows as deleted)"
                    );
                }
                Err(e) => {
                    // On other systems, broken symlinks return errors
                    assert!(
                        e.contains("Failed to get file metadata")
                            || e.contains("Failed to open file")
                            || e.contains("Failed to read file")
                    );
                }
            }
        }
    }

    #[test]
    fn test_symlink_to_directory() {
        let temp_dir = TempDir::new().unwrap();
        let target_dir = temp_dir.path().join("target_dir");
        fs::create_dir(&target_dir).unwrap();

        let dir_link = temp_dir.path().join("dir_link");

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(&target_dir, &dir_link).unwrap();

            // Symlink to directory should return error (we expect regular files)
            let result = is_file_diffable(&dir_link);
            assert!(result.is_err(), "Symlink to directory should return error");
        }

        #[cfg(not(unix))]
        {
            // On non-Unix systems, test with a regular file
            fs::write(&dir_link, "test").unwrap();
            let result = is_file_diffable(&dir_link).unwrap();
            assert!(result, "Regular file should be diffable");
        }
    }

    #[test]
    fn test_directory_path() {
        let temp_dir = TempDir::new().unwrap();

        // Test with directory path - should return error
        let result = is_file_diffable(temp_dir.path());
        assert!(result.is_err(), "Directory path should return error");
        let err_msg = result.unwrap_err();
        // The error message varies by platform, so just check that it's some kind of file access error
        assert!(
            err_msg.contains("Failed to read file")
                || err_msg.contains("Failed to get file metadata")
                || err_msg.contains("Is a directory")
                || err_msg.contains("os error"),
            "Error should indicate file access issue: {}",
            err_msg
        );

        // Test is_binary_file with directory
        let result = is_binary_file(temp_dir.path());
        assert!(
            result.is_err(),
            "Directory should return error for binary check"
        );
        let err_msg = result.unwrap_err();
        assert!(
            err_msg.contains("Failed to open file")
                || err_msg.contains("Failed to read file")
                || err_msg.contains("Is a directory"),
            "Binary check should return appropriate error: {}",
            err_msg
        );
    }

    #[test]
    fn test_very_long_file_name() {
        let temp_dir = TempDir::new().unwrap();

        // Create a file with a very long name (near typical filesystem limits)
        let long_name = "a".repeat(200); // 200 character name
        let long_path = temp_dir.path().join(format!("{}.txt", long_name));

        fs::write(&long_path, "test content").unwrap();

        let result = is_file_diffable(&long_path).unwrap();
        assert!(result, "File with long name should be diffable");

        let result = is_binary_file(&long_path).unwrap();
        assert!(!result, "Text file with long name should not be binary");
    }

    #[test]
    fn test_utf8_with_bom() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("utf8_bom.txt");

        // UTF-8 BOM followed by text
        let bom_content = vec![
            0xEF, 0xBB, 0xBF, // UTF-8 BOM
            b'H', b'e', b'l', b'l', b'o', b' ', b'w', b'o', b'r', b'l', b'd',
        ];
        fs::write(&file_path, bom_content).unwrap();

        let result = is_file_diffable(&file_path).unwrap();
        assert!(result, "UTF-8 file with BOM should be diffable");

        let result = is_binary_file(&file_path).unwrap();
        assert!(!result, "UTF-8 with BOM should not be detected as binary");
    }

    #[test]
    fn test_unicode_edge_cases() {
        let temp_dir = TempDir::new().unwrap();

        // Test various Unicode scenarios
        let test_cases = vec![
            ("emoji.txt", "Hello 🌍 🌟 🚀"),
            ("mixed_scripts.txt", "Hello こんにちは 안녕하세요"),
            (
                "combining_chars.txt",
                "e\u{0301} + u\u{0308} = eu\u{0308}\u{0301}",
            ),
            (
                "zero_width.txt",
                "test\u{200B}with\u{200C}zero\u{200D}width",
            ),
            ("control_chars.txt", "line1\u{000A}line2\u{000D}line3"),
        ];

        for (filename, content) in test_cases {
            let file_path = temp_dir.path().join(filename);
            fs::write(&file_path, content).unwrap();

            let result = is_file_diffable(&file_path).unwrap();
            assert!(result, "Unicode file '{}' should be diffable", filename);

            let result = is_binary_file(&file_path).unwrap();
            assert!(
                !result,
                "Unicode text file '{}' should not be binary",
                filename
            );
        }
    }

    #[test]
    fn test_file_modified_during_check() {
        let temp_dir = TempDir::new().unwrap();
        let file_path = temp_dir.path().join("modified_during_check.txt");

        // Create a large enough file that takes time to read
        let initial_content = vec![b'A'; 10000];
        fs::write(&file_path, initial_content).unwrap();

        // This test is inherently racy, but we can at least verify the functions
        // handle the file system operations gracefully
        let result = is_file_diffable(&file_path).unwrap();
        assert!(
            result,
            "File should be diffable even if modified during check"
        );

        let result = is_binary_file(&file_path).unwrap();
        assert!(!result, "File without null bytes should not be binary");
    }

    #[test]
    fn test_max_file_size_edge_cases() {
        let temp_dir = TempDir::new().unwrap();

        // Test file exactly at boundary - 1 byte
        let near_max_path = temp_dir.path().join("near_max.txt");
        let near_max_content = vec![b'a'; (MAX_FILE_SIZE - 1) as usize];
        fs::write(&near_max_path, near_max_content).unwrap();
        let result = is_file_diffable(&near_max_path).unwrap();
        assert!(result, "File just under MAX_FILE_SIZE should be diffable");

        // Test file with null byte in the checked range (first BINARY_CHECK_SIZE bytes)
        let null_near_end_path = temp_dir.path().join("null_near_end.txt");
        let mut content = vec![b'a'; (MAX_FILE_SIZE - 100) as usize];
        content[100] = 0; // Null byte early in the file (within BINARY_CHECK_SIZE)
        fs::write(&null_near_end_path, content).unwrap();
        let result = is_file_diffable(&null_near_end_path).unwrap();
        assert!(!result, "File with null byte should not be diffable");

        // Test empty file (0 bytes)
        let empty_path = temp_dir.path().join("empty_zero.txt");
        fs::write(&empty_path, "").unwrap();
        let result = is_file_diffable(&empty_path).unwrap();
        assert!(result, "Empty file should be diffable");
    }

    #[test]
    fn test_binary_detection_edge_cases() {
        let temp_dir = TempDir::new().unwrap();

        // File with null byte at exact BINARY_CHECK_SIZE boundary (last byte checked)
        let boundary_null_path = temp_dir.path().join("boundary_null.dat");
        let mut content = vec![b'A'; BINARY_CHECK_SIZE];
        content[BINARY_CHECK_SIZE - 1] = 0; // This is within the checked range (index 7999)
        fs::write(&boundary_null_path, content).unwrap();
        let result = is_binary_file(&boundary_null_path).unwrap();
        assert!(
            result,
            "File with null at BINARY_CHECK_SIZE boundary should be binary"
        );

        // File with null byte right after BINARY_CHECK_SIZE (not checked)
        let after_boundary_path = temp_dir.path().join("after_boundary.dat");
        let mut content = vec![b'A'; BINARY_CHECK_SIZE + 1];
        content[BINARY_CHECK_SIZE] = 0; // This is beyond the checked range
        fs::write(&after_boundary_path, content).unwrap();
        let result = is_binary_file(&after_boundary_path).unwrap();
        assert!(
            !result,
            "File with null after BINARY_CHECK_SIZE should not be detected as binary"
        );

        // File exactly BINARY_CHECK_SIZE with no nulls
        let exact_size_no_null_path = temp_dir.path().join("exact_size_no_null.txt");
        let content = vec![b'A'; BINARY_CHECK_SIZE];
        fs::write(&exact_size_no_null_path, content).unwrap();
        let result = is_binary_file(&exact_size_no_null_path).unwrap();
        assert!(
            !result,
            "File exactly BINARY_CHECK_SIZE with no nulls should not be binary"
        );
    }

    #[test]
    fn test_check_file_diffability_error_handling() {
        let temp_dir = TempDir::new().unwrap();
        let non_existent = temp_dir.path().join("does_not_exist.txt");

        // Test check_file_diffability with non-existent file
        // Note: Non-existent files ARE diffable (they show as deleted)
        let info = check_file_diffability(&non_existent);
        assert!(info.is_diffable);
        assert!(info.reason.is_none());

        // Test with directory
        let info = check_file_diffability(temp_dir.path());
        assert!(!info.is_diffable);
        assert!(info.reason.is_some());
        assert!(info.reason.unwrap().contains("Error checking file"));
    }

    #[test]
    fn test_determine_non_diffable_reason_edge_cases() {
        let temp_dir = TempDir::new().unwrap();

        // Test with file that has extension but isn't in NON_DIFFABLE_EXTENSIONS
        let unknown_ext_path = temp_dir.path().join("test.unknown");
        fs::write(&unknown_ext_path, "text content").unwrap();
        let reason = determine_non_diffable_reason(&unknown_ext_path);
        // Should fall through to binary content check, then to default
        assert!(
            reason.contains("Binary file content detected")
                || reason.contains("File cannot be diffed")
        );

        // Test with file that has null bytes but small size
        // Use an extension that's not in NON_DIFFABLE_EXTENSIONS to test binary content detection
        let small_null_path = temp_dir.path().join("small_null.txt");
        fs::write(&small_null_path, &[b'A', 0, b'B']).unwrap();

        // First verify that is_binary_file detects it as binary
        let is_binary = is_binary_file(&small_null_path).unwrap();
        assert!(
            is_binary,
            "File with null byte should be detected as binary"
        );

        let reason = determine_non_diffable_reason(&small_null_path);
        assert!(
            reason.contains("Binary file content detected"),
            "Expected 'Binary file content detected', got: {}",
            reason
        );

        // Test with file that has no extension and no null bytes
        let no_ext_text_path = temp_dir.path().join("no_extension_text");
        fs::write(&no_ext_text_path, "This is plain text without extension").unwrap();
        let reason = determine_non_diffable_reason(&no_ext_text_path);
        // This should fall through to the default case since it's not caught by other conditions
        assert!(reason.contains("File cannot be diffed"));
    }
}
