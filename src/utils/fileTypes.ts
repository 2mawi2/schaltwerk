/**
 * Centralized file type definitions for syntax highlighting, icons, and categorization.
 * This consolidates language detection and file categorization across the codebase.
 */

export type FileCategory = 'code' | 'config' | 'doc' | 'binary' | 'other'

interface FileTypeDefinition {
  extensions: string[]
  language: string
  category: FileCategory
}

const FILE_TYPES: FileTypeDefinition[] = [
  // Programming languages
  { extensions: ['ts', 'tsx'], language: 'typescript', category: 'code' },
  { extensions: ['js', 'jsx', 'mjs', 'cjs'], language: 'javascript', category: 'code' },
  { extensions: ['rs'], language: 'rust', category: 'code' },
  { extensions: ['py', 'pyw'], language: 'python', category: 'code' },
  { extensions: ['rb'], language: 'ruby', category: 'code' },
  { extensions: ['go'], language: 'go', category: 'code' },
  { extensions: ['java'], language: 'java', category: 'code' },
  { extensions: ['kt', 'kts'], language: 'kotlin', category: 'code' },
  { extensions: ['swift'], language: 'swift', category: 'code' },
  { extensions: ['c', 'h'], language: 'c', category: 'code' },
  { extensions: ['cpp', 'cc', 'cxx', 'hpp', 'hxx'], language: 'cpp', category: 'code' },
  { extensions: ['cs'], language: 'csharp', category: 'code' },
  { extensions: ['php'], language: 'php', category: 'code' },
  { extensions: ['scala'], language: 'scala', category: 'code' },
  { extensions: ['clj', 'cljs', 'cljc'], language: 'clojure', category: 'code' },
  { extensions: ['ex', 'exs'], language: 'elixir', category: 'code' },
  { extensions: ['erl', 'hrl'], language: 'erlang', category: 'code' },
  { extensions: ['hs', 'lhs'], language: 'haskell', category: 'code' },
  { extensions: ['lua'], language: 'lua', category: 'code' },
  { extensions: ['r', 'R'], language: 'r', category: 'code' },
  { extensions: ['jl'], language: 'julia', category: 'code' },
  { extensions: ['dart'], language: 'dart', category: 'code' },
  { extensions: ['zig'], language: 'zig', category: 'code' },
  { extensions: ['nim'], language: 'nim', category: 'code' },
  { extensions: ['v'], language: 'v', category: 'code' },
  { extensions: ['odin'], language: 'odin', category: 'code' },

  // Shell/scripting
  { extensions: ['sh', 'bash', 'zsh', 'fish'], language: 'bash', category: 'code' },
  { extensions: ['ps1', 'psm1'], language: 'powershell', category: 'code' },
  { extensions: ['bat', 'cmd'], language: 'batch', category: 'code' },

  // Web
  { extensions: ['html', 'htm'], language: 'html', category: 'code' },
  { extensions: ['css'], language: 'css', category: 'code' },
  { extensions: ['scss', 'sass'], language: 'scss', category: 'code' },
  { extensions: ['less'], language: 'less', category: 'code' },
  { extensions: ['vue'], language: 'vue', category: 'code' },
  { extensions: ['svelte'], language: 'svelte', category: 'code' },

  // Data/query
  { extensions: ['sql'], language: 'sql', category: 'code' },
  { extensions: ['graphql', 'gql'], language: 'graphql', category: 'code' },

  // Config files
  { extensions: ['json', 'jsonc'], language: 'json', category: 'config' },
  { extensions: ['yaml', 'yml'], language: 'yaml', category: 'config' },
  { extensions: ['toml'], language: 'toml', category: 'config' },
  { extensions: ['xml', 'xsl', 'xslt'], language: 'xml', category: 'config' },
  { extensions: ['ini', 'cfg', 'conf'], language: 'ini', category: 'config' },
  { extensions: ['env'], language: 'dotenv', category: 'config' },
  { extensions: ['properties'], language: 'properties', category: 'config' },

  // Documentation
  { extensions: ['md', 'mdx', 'markdown'], language: 'markdown', category: 'doc' },
  { extensions: ['txt', 'text'], language: 'plaintext', category: 'doc' },
  { extensions: ['rst'], language: 'restructuredtext', category: 'doc' },
  { extensions: ['adoc', 'asciidoc'], language: 'asciidoc', category: 'doc' },
  { extensions: ['org'], language: 'org', category: 'doc' },
  { extensions: ['tex', 'latex'], language: 'latex', category: 'doc' },

  // Special files
  { extensions: ['dockerfile'], language: 'dockerfile', category: 'config' },
  { extensions: ['makefile', 'mk'], language: 'makefile', category: 'config' },
]

const extensionToLanguageMap = new Map<string, string>()
const extensionToCategoryMap = new Map<string, FileCategory>()

for (const def of FILE_TYPES) {
  for (const ext of def.extensions) {
    extensionToLanguageMap.set(ext.toLowerCase(), def.language)
    extensionToCategoryMap.set(ext.toLowerCase(), def.category)
  }
}

/**
 * Get the programming language for syntax highlighting from a file path.
 * Returns null if the language cannot be determined.
 */
export function getLanguageFromPath(filePath: string): string | null {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (!ext) return null
  return extensionToLanguageMap.get(ext) ?? null
}

/**
 * Get the file category from a file path.
 */
export function getFileCategoryFromPath(filePath: string): FileCategory {
  const ext = filePath.split('.').pop()?.toLowerCase()
  if (!ext) return 'other'
  return extensionToCategoryMap.get(ext) ?? 'other'
}

/**
 * Check if a file is a code file based on extension.
 */
export function isCodeFile(filePath: string): boolean {
  return getFileCategoryFromPath(filePath) === 'code'
}

/**
 * Check if a file is a config file based on extension.
 */
export function isConfigFile(filePath: string): boolean {
  return getFileCategoryFromPath(filePath) === 'config'
}

/**
 * Check if a file is a documentation file based on extension.
 */
export function isDocFile(filePath: string): boolean {
  return getFileCategoryFromPath(filePath) === 'doc'
}

/**
 * Check if a file is a markdown file.
 */
export function isMarkdownFile(filePath: string): boolean {
  const ext = filePath.split('.').pop()?.toLowerCase()
  return ext === 'md' || ext === 'mdx' || ext === 'markdown'
}
