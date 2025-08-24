use std::collections::HashSet;

static BINARY_EXTENSIONS: &[&str] = &[
    // Image files
    "png", "jpg", "jpeg", "gif", "bmp", "tiff", "tif", "webp", "ico", "svg",
    // Audio files
    "mp3", "wav", "flac", "aac", "ogg", "m4a", "wma",
    // Video files
    "mp4", "avi", "mkv", "mov", "wmv", "flv", "webm", "m4v",
    // Archive files
    "zip", "rar", "7z", "tar", "gz", "bz2", "xz", "lz4", "lzma",
    // Executable files
    "exe", "dll", "so", "dylib", "bin", "app", "deb", "rpm", "dmg", "pkg",
    // Office files
    "doc", "docx", "xls", "xlsx", "ppt", "pptx", "pdf", "odt", "ods", "odp",
    // Database files
    "db", "sqlite", "sqlite3", "mdb", "accdb",
    // Font files
    "ttf", "otf", "woff", "woff2", "eot",
    // Other binary formats
    "pyc", "class", "jar", "war", "ear", "o", "obj", "lib", "a"
];

lazy_static::lazy_static! {
    static ref BINARY_EXTENSIONS_SET: HashSet<&'static str> = {
        BINARY_EXTENSIONS.iter().cloned().collect()
    };
}

pub fn is_binary_file_by_extension(file_path: &str) -> bool {
    if file_path.is_empty() {
        return false;
    }

    let ext = match file_path.split('.').next_back() {
        Some(e) => e.to_lowercase(),
        None => return false,
    };
    
    BINARY_EXTENSIONS_SET.contains(ext.as_str())
}

pub fn is_likely_binary_content(bytes: &[u8]) -> bool {
    // Use Git's standard algorithm: check for null bytes in first 8000 bytes
    // This matches Git's buffer_is_binary() function
    let check_size = std::cmp::min(8000, bytes.len());
    let sample = &bytes[..check_size];
    
    // Check for null bytes (Git's standard binary detection)
    sample.contains(&0)
}

pub fn get_unsupported_reason(file_path: &str, content_bytes: Option<&[u8]>) -> Option<String> {
    if is_binary_file_by_extension(file_path) {
        return Some(format!("Binary file type ({})", 
            file_path.split('.').next_back().unwrap_or("unknown")));
    }
    
    if let Some(bytes) = content_bytes {
        if bytes.len() > 10 * 1024 * 1024 {
            return Some("File is too large to diff (>10MB)".to_string());
        }
        
        if is_likely_binary_content(bytes) {
            return Some("File contains binary data".to_string());
        }
    }
    
    None
}


#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_is_binary_file_by_extension() {
        // Test image files
        assert!(is_binary_file_by_extension("test.png"));
        assert!(is_binary_file_by_extension("image.jpg"));
        assert!(is_binary_file_by_extension("photo.JPEG"));
        
        // Test archive files
        assert!(is_binary_file_by_extension("archive.zip"));
        assert!(is_binary_file_by_extension("compressed.tar.gz"));
        
        // Test executable files
        assert!(is_binary_file_by_extension("program.exe"));
        assert!(is_binary_file_by_extension("library.dll"));
        assert!(is_binary_file_by_extension("lib.so"));
        
        // Test office files
        assert!(is_binary_file_by_extension("document.pdf"));
        assert!(is_binary_file_by_extension("spreadsheet.xlsx"));
        
        // Test text files (should return false)
        assert!(!is_binary_file_by_extension("code.rs"));
        assert!(!is_binary_file_by_extension("text.txt"));
        assert!(!is_binary_file_by_extension("config.json"));
        assert!(!is_binary_file_by_extension("style.css"));
        assert!(!is_binary_file_by_extension("script.js"));
        
        // Test edge cases
        assert!(!is_binary_file_by_extension(""));
        assert!(!is_binary_file_by_extension("no_extension"));
        assert!(!is_binary_file_by_extension("multiple.dots.txt"));
    }

    #[test]
    fn test_is_likely_binary_content() {
        // Test text content
        let text_content = b"Hello, world!\nThis is a text file.";
        assert!(!is_likely_binary_content(text_content));
        
        // Test binary content with null bytes
        let binary_content = b"Hello\x00World\x00Binary";
        assert!(is_likely_binary_content(binary_content));
        
        // Test empty content
        let empty_content = b"";
        assert!(!is_likely_binary_content(empty_content));
        
        // Test large text content
        let large_text = "A".repeat(10000).into_bytes();
        assert!(!is_likely_binary_content(&large_text));
        
        // Test content with null byte at the end (within check limit)
        let mut text_with_null = "Text content".to_string().into_bytes();
        text_with_null.push(0);
        assert!(is_likely_binary_content(&text_with_null));
    }

    #[test]
    fn test_get_unsupported_reason() {
        // Test binary file by extension
        let reason = get_unsupported_reason("test.png", None);
        assert!(reason.is_some());
        assert!(reason.unwrap().contains("Binary file type (png)"));
        
        // Test large file
        let large_content = vec![b'A'; 11 * 1024 * 1024]; // 11MB
        let reason = get_unsupported_reason("large.txt", Some(&large_content));
        assert!(reason.is_some());
        assert!(reason.unwrap().contains("too large"));
        
        // Test binary content
        let binary_content = b"Hello\x00World";
        let reason = get_unsupported_reason("test.txt", Some(binary_content));
        assert!(reason.is_some());
        assert!(reason.unwrap().contains("binary data"));
        
        // Test normal text file
        let text_content = b"Hello, world!";
        let reason = get_unsupported_reason("test.txt", Some(text_content));
        assert!(reason.is_none());
    }

    #[test]
    fn test_case_insensitive_extensions() {
        assert!(is_binary_file_by_extension("IMAGE.PNG"));
        assert!(is_binary_file_by_extension("Document.PDF"));
        assert!(is_binary_file_by_extension("Music.MP3"));
        assert!(is_binary_file_by_extension("Video.Mp4"));
    }


    #[test]
    fn test_extension_consistency() {
        // Verify all extensions in the static array are detected correctly
        for ext in BINARY_EXTENSIONS.iter() {
            let test_file = format!("test.{}", ext);
            assert!(is_binary_file_by_extension(&test_file), 
                "Extension {} should be detected as binary", ext);
        }
    }
}