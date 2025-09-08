import { logger } from '../utils/logger'

// Legacy diff utilities - now replaced with Rust backend
// These functions are kept for backward compatibility and tests only
export type { LineInfo } from '../types/diff'
import type { LineInfo } from '../types/diff'

const COLLAPSE_THRESHOLD = 4
const CONTEXT_LINES = 3

// Legacy function - use Rust backend compute_unified_diff_backend instead
export function computeUnifiedDiff(oldContent: string, newContent: string): LineInfo[] {
  logger.warn('computeUnifiedDiff is deprecated - use Rust backend instead')
  
  // Handle empty content edge cases to match test expectations
  if (!oldContent && !newContent) return []
  if (!oldContent) return [{ content: newContent, type: 'added', newLineNumber: 1 }]
  if (!newContent) return [{ content: oldContent, type: 'removed', oldLineNumber: 1 }]
  
  // Simple line-by-line comparison for backward compatibility
  const oldLines = oldContent.split('\n')
  const newLines = newContent.split('\n')
  
  const lines: LineInfo[] = []
  let oldLineNum = 1
  let newLineNum = 1
  
  // Process lines using a simple LCS-like algorithm
  let i = 0, j = 0
  while (i < oldLines.length || j < newLines.length) {
    if (i < oldLines.length && j < newLines.length) {
      if (oldLines[i] === newLines[j]) {
        // Lines match
        lines.push({
          content: oldLines[i],
          type: 'unchanged',
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++
        })
        i++
        j++
      } else {
        // Look ahead to see if we can find a match
        let foundMatch = false
        for (let k = j + 1; k < newLines.length && k < j + 3; k++) {
          if (oldLines[i] === newLines[k]) {
            // Found old line later in new - lines were added
            while (j < k) {
              lines.push({
                content: newLines[j],
                type: 'added',
                newLineNumber: newLineNum++
              })
              j++
            }
            foundMatch = true
            break
          }
        }
        
        if (!foundMatch) {
          for (let k = i + 1; k < oldLines.length && k < i + 3; k++) {
            if (oldLines[k] === newLines[j]) {
              // Found new line later in old - lines were removed  
              while (i < k) {
                lines.push({
                  content: oldLines[i],
                  type: 'removed',
                  oldLineNumber: oldLineNum++
                })
                i++
              }
              foundMatch = true
              break
            }
          }
        }
        
        if (!foundMatch) {
          // No match found, treat as modification
          lines.push({
            content: oldLines[i],
            type: 'removed',
            oldLineNumber: oldLineNum++
          })
          lines.push({
            content: newLines[j],
            type: 'added',
            newLineNumber: newLineNum++
          })
          i++
          j++
        }
      }
    } else if (i < oldLines.length) {
      // Only old lines remaining - removed
      lines.push({
        content: oldLines[i],
        type: 'removed',
        oldLineNumber: oldLineNum++
      })
      i++
    } else {
      // Only new lines remaining - added
      lines.push({
        content: newLines[j],
        type: 'added',
        newLineNumber: newLineNum++
      })
      j++
    }
  }
  
  return lines
}

export function addCollapsibleSections(lines: LineInfo[]): LineInfo[] {
  const processedLines: LineInfo[] = []
  let i = 0
  
  while (i < lines.length) {
    if (lines[i].type === 'unchanged') {
      let j = i
      while (j < lines.length && lines[j].type === 'unchanged') j++
      
      const unchangedCount = j - i
      
      if (unchangedCount > COLLAPSE_THRESHOLD + 2 * CONTEXT_LINES) {
        // Add context before
        for (let k = 0; k < CONTEXT_LINES && i < j; k++, i++) {
          processedLines.push(lines[i])
        }
        
        // Add collapsed indicator with the hidden lines
        const collapsedCount = j - i - CONTEXT_LINES
        if (collapsedCount > 0) {
          const collapsedLines: LineInfo[] = []
          const startIdx = i
          for (let k = 0; k < collapsedCount && i < j - CONTEXT_LINES; k++, i++) {
            collapsedLines.push(lines[i])
          }
          
          processedLines.push({
            content: '',
            type: 'unchanged',
            isCollapsible: true,
            collapsedCount,
            collapsedLines,
            oldLineNumber: lines[startIdx].oldLineNumber,
            newLineNumber: lines[startIdx].newLineNumber
          })
        }
        
        // Add context after
        for (let k = 0; k < CONTEXT_LINES && i < j; k++, i++) {
          processedLines.push(lines[i])
        }
      } else {
        // Add all unchanged lines
        while (i < j) {
          processedLines.push(lines[i++])
        }
      }
    } else {
      processedLines.push(lines[i++])
    }
  }
  
  return processedLines
}



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