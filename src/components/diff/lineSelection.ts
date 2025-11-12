import type { LineInfo } from '../../types/diff'

export function getSelectableLineIdentity(line: LineInfo): { lineNum?: number; side: 'old' | 'new' } {
  const side: 'old' | 'new' = line.type === 'removed' ? 'old' : 'new'
  const preferred = side === 'old' ? line.oldLineNumber : line.newLineNumber
  const fallback = side === 'old' ? line.newLineNumber : line.oldLineNumber

  return {
    side,
    lineNum: preferred ?? fallback
  }
}
