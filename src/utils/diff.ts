export type { LineInfo, SplitDiffResult, DiffStats, FileInfo, DiffResponse, SplitDiffResponse } from '../types/diff'

export function getFileLanguage(filePath: string): string | undefined {
  if (!filePath) return undefined
  const ext = filePath.split('.').pop()?.toLowerCase()
  
  const languageMap: Record<string, string> = {
    'ts': 'typescript', 'tsx': 'typescript',
    'js': 'javascript', 'jsx': 'javascript',
    'rs': 'rust', 'py': 'python', 'go': 'go',
    'java': 'java', 'kt': 'kotlin', 'swift': 'swift',
    'c': 'c', 'h': 'c',
    'cpp': 'cpp', 'cc': 'cpp', 'cxx': 'cpp',
    'cs': 'csharp', 'rb': 'ruby', 'php': 'php',
    'sh': 'bash', 'bash': 'bash', 'zsh': 'bash',
    'json': 'json', 'yml': 'yaml', 'yaml': 'yaml',
    'toml': 'toml', 'md': 'markdown',
    'css': 'css', 'scss': 'scss', 'less': 'less'
  }
  
  return languageMap[ext || '']
}