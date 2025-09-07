import { describe, it, expect } from 'vitest'
import { 
  computeUnifiedDiff, 
  addCollapsibleSections, 
  getFileLanguage
} from './diff'

describe('diff utilities', () => {
  describe('computeUnifiedDiff', () => {
    it('identifies added lines', () => {
      const oldContent = 'line1\nline2'
      const newContent = 'line1\nline2\nline3'
      
      const result = computeUnifiedDiff(oldContent, newContent)
      
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        content: 'line1',
        type: 'unchanged',
        oldLineNumber: 1,
        newLineNumber: 1
      })
      expect(result[1]).toEqual({
        content: 'line2',
        type: 'unchanged',
        oldLineNumber: 2,
        newLineNumber: 2
      })
      expect(result[2]).toEqual({
        content: 'line3',
        type: 'added',
        newLineNumber: 3
      })
    })
    
    it('identifies removed lines', () => {
      const oldContent = 'line1\nline2\nline3'
      const newContent = 'line1\nline3'
      
      const result = computeUnifiedDiff(oldContent, newContent)
      
      expect(result).toHaveLength(3)
      expect(result[0]).toEqual({
        content: 'line1',
        type: 'unchanged',
        oldLineNumber: 1,
        newLineNumber: 1
      })
      expect(result[1]).toEqual({
        content: 'line2',
        type: 'removed',
        oldLineNumber: 2
      })
      expect(result[2]).toEqual({
        content: 'line3',
        type: 'unchanged',
        oldLineNumber: 3,
        newLineNumber: 2
      })
    })
    
    it('handles mixed changes', () => {
      const oldContent = 'foo\nbar\nbaz'
      const newContent = 'foo\nmodified\nbaz\nextra'
      
      const result = computeUnifiedDiff(oldContent, newContent)
      
      expect(result.filter(l => l.type === 'unchanged')).toHaveLength(2)
      expect(result.filter(l => l.type === 'removed')).toHaveLength(1)
      expect(result.filter(l => l.type === 'added')).toHaveLength(2)
    })
    
    it('handles empty files', () => {
      const result1 = computeUnifiedDiff('', 'new content')
      expect(result1).toHaveLength(1)
      expect(result1[0].type).toBe('added')
      
      const result2 = computeUnifiedDiff('old content', '')
      expect(result2).toHaveLength(1)
      expect(result2[0].type).toBe('removed')
      
      const result3 = computeUnifiedDiff('', '')
      expect(result3).toHaveLength(0)
    })
  })
  
  describe('addCollapsibleSections', () => {
    it('does not collapse small unchanged sections', () => {
      const lines = [
        { content: 'a', type: 'unchanged' as const, oldLineNumber: 1, newLineNumber: 1 },
        { content: 'b', type: 'unchanged' as const, oldLineNumber: 2, newLineNumber: 2 },
        { content: 'c', type: 'unchanged' as const, oldLineNumber: 3, newLineNumber: 3 }
      ]
      
      const result = addCollapsibleSections(lines)
      expect(result).toEqual(lines)
    })
    
    it('collapses large unchanged sections', () => {
      const lines = []
      // Add 20 unchanged lines
      for (let i = 1; i <= 20; i++) {
        lines.push({
          content: `line${i}`,
          type: 'unchanged' as const,
          oldLineNumber: i,
          newLineNumber: i
        })
      }
      
      const result = addCollapsibleSections(lines)
      
      // Should have context lines + collapsed indicator + context lines
      expect(result.length).toBeLessThan(lines.length)
      
      // Check for collapsed indicator
      const collapsedLine = result.find(l => l.isCollapsible)
      expect(collapsedLine).toBeDefined()
      expect(collapsedLine?.collapsedCount).toBeGreaterThan(0)
    })
    
    it('preserves changed lines', () => {
      const lines = [
        { content: 'a', type: 'unchanged' as const, oldLineNumber: 1, newLineNumber: 1 },
        { content: 'removed', type: 'removed' as const, oldLineNumber: 2 },
        { content: 'added', type: 'added' as const, newLineNumber: 2 },
        { content: 'b', type: 'unchanged' as const, oldLineNumber: 3, newLineNumber: 3 }
      ]
      
      const result = addCollapsibleSections(lines)
      
      // All changed lines should be preserved
      expect(result.filter(l => l.type === 'removed')).toHaveLength(1)
      expect(result.filter(l => l.type === 'added')).toHaveLength(1)
    })
  })
  

  
  describe('getFileLanguage', () => {
    it('identifies TypeScript files', () => {
      expect(getFileLanguage('file.ts')).toBe('typescript')
      expect(getFileLanguage('component.tsx')).toBe('typescript')
    })
    
    it('identifies JavaScript files', () => {
      expect(getFileLanguage('script.js')).toBe('javascript')
      expect(getFileLanguage('component.jsx')).toBe('javascript')
    })
    
    it('identifies Rust files', () => {
      expect(getFileLanguage('main.rs')).toBe('rust')
    })
    
    it('returns undefined for unknown extensions', () => {
      expect(getFileLanguage('file.xyz')).toBeUndefined()
      expect(getFileLanguage('noextension')).toBeUndefined()
    })
    
    it('handles nested paths', () => {
      expect(getFileLanguage('src/components/App.tsx')).toBe('typescript')
      expect(getFileLanguage('/usr/local/bin/script.sh')).toBe('bash')
    })
    
    it('handles empty input', () => {
      expect(getFileLanguage('')).toBeUndefined()
    })
  })
})