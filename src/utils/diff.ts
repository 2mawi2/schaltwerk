import { diffLines } from 'diff'

export interface LineInfo {
  content: string
  type: 'added' | 'removed' | 'unchanged'
  oldLineNumber?: number
  newLineNumber?: number
  isCollapsible?: boolean
  collapsedCount?: number
  collapsedLines?: LineInfo[]
}

export interface SplitDiffResult {
  leftLines: LineInfo[]
  rightLines: LineInfo[]
}

const COLLAPSE_THRESHOLD = 4
const CONTEXT_LINES = 3

export function computeUnifiedDiff(oldContent: string, newContent: string): LineInfo[] {
  // Ensure content ends with a single trailing newline without expensive split/join
  const oldText = oldContent ? (oldContent.endsWith('\n') ? oldContent : oldContent + '\n') : ''
  const newText = newContent ? (newContent.endsWith('\n') ? newContent : newContent + '\n') : ''

  const changes = diffLines(oldText, newText)
  
  const lines: LineInfo[] = []
  let oldLineNum = 1
  let newLineNum = 1
  
  for (const change of changes) {
    const changeLines = change.value.split('\n')
    // Remove last empty line from split (artifact of ending newline)
    if (changeLines.length > 0 && changeLines[changeLines.length - 1] === '') {
      changeLines.pop()
    }
    
    for (const line of changeLines) {
      if (change.added) {
        lines.push({
          content: line,
          type: 'added',
          newLineNumber: newLineNum++
        })
      } else if (change.removed) {
        lines.push({
          content: line,
          type: 'removed',
          oldLineNumber: oldLineNum++
        })
      } else {
        lines.push({
          content: line,
          type: 'unchanged',
          oldLineNumber: oldLineNum++,
          newLineNumber: newLineNum++
        })
      }
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

export function computeSplitDiff(oldContent: string, newContent: string): SplitDiffResult {
  // Ensure content ends with a single trailing newline without expensive split/join
  const oldText = oldContent ? (oldContent.endsWith('\n') ? oldContent : oldContent + '\n') : ''
  const newText = newContent ? (newContent.endsWith('\n') ? newContent : newContent + '\n') : ''

  const changes = diffLines(oldText, newText)
  
  const leftLines: LineInfo[] = []
  const rightLines: LineInfo[] = []
  let oldIdx = 0
  let newIdx = 0
  
  for (const change of changes) {
    const changeLines = change.value.split('\n')
    // Remove last empty line from split (artifact of ending newline)
    if (changeLines.length > 0 && changeLines[changeLines.length - 1] === '') {
      changeLines.pop()
    }
    
    if (change.removed) {
      for (const line of changeLines) {
        leftLines.push({
          content: line,
          type: 'removed',
          oldLineNumber: oldIdx + 1
        })
        rightLines.push({ content: '', type: 'unchanged' })
        oldIdx++
      }
    } else if (change.added) {
      for (const line of changeLines) {
        leftLines.push({ content: '', type: 'unchanged' })
        rightLines.push({
          content: line,
          type: 'added',
          newLineNumber: newIdx + 1
        })
        newIdx++
      }
    } else {
      for (const line of changeLines) {
        leftLines.push({
          content: line,
          type: 'unchanged',
          oldLineNumber: oldIdx + 1
        })
        rightLines.push({
          content: line,
          type: 'unchanged',
          newLineNumber: newIdx + 1
        })
        oldIdx++
        newIdx++
      }
    }
  }
  
  return { leftLines, rightLines }
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