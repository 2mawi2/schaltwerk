// Binary file extensions - keep in sync with Rust binary_detection.rs
const BINARY_EXTENSIONS = [
  // Image files
  'png', 'jpg', 'jpeg', 'gif', 'bmp', 'tiff', 'tif', 'webp', 'ico', 'svg',
  // Audio files
  'mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a', 'wma',
  // Video files
  'mp4', 'avi', 'mkv', 'mov', 'wmv', 'flv', 'webm', 'm4v',
  // Archive files
  'zip', 'rar', '7z', 'tar', 'gz', 'bz2', 'xz', 'lz4', 'lzma',
  // Executable files
  'exe', 'dll', 'so', 'dylib', 'bin', 'app', 'deb', 'rpm', 'dmg', 'pkg',
  // Office files
  'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'pdf', 'odt', 'ods', 'odp',
  // Database files
  'db', 'sqlite', 'sqlite3', 'mdb', 'accdb',
  // Font files
  'ttf', 'otf', 'woff', 'woff2', 'eot',
  // Other binary formats
  'pyc', 'class', 'jar', 'war', 'ear', 'o', 'obj', 'lib', 'a'
] as const

// Create a Set for efficient lookups
const BINARY_EXTENSIONS_SET = new Set(BINARY_EXTENSIONS)

/**
 * Check if a file is likely binary based on its extension
 * @param filePath - The file path to check
 * @returns true if the file extension indicates a binary file
 */
export function isBinaryFileByExtension(filePath: string): boolean {
  if (!filePath) return false
  
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (!ext) return false
  
  return BINARY_EXTENSIONS_SET.has(ext as typeof BINARY_EXTENSIONS[number])
}

/**
 * Get all supported binary file extensions
 * @returns Array of binary file extensions
 */
export function getBinaryExtensions(): readonly string[] {
  return BINARY_EXTENSIONS
}

/**
 * Check if a file extension is binary
 * @param extension - File extension (without dot)
 * @returns true if extension is for a binary file type
 */
export function isBinaryExtension(extension: string): boolean {
  return BINARY_EXTENSIONS_SET.has(extension.toLowerCase() as typeof BINARY_EXTENSIONS[number])
}