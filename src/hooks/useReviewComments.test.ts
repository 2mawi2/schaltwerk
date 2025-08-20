import { renderHook } from '@testing-library/react'
import { describe, it, expect } from 'vitest'
import { useReviewComments } from './useReviewComments'
import { ReviewComment } from '../types/review'

describe('useReviewComments', () => {
  const createMockComment = (overrides?: Partial<ReviewComment>): ReviewComment => ({
    id: '1',
    filePath: 'src/components/Example.tsx',
    lineRange: { start: 10, end: 15 },
    side: 'new',
    selectedText: 'const example = true',
    comment: 'This is a test comment',
    timestamp: Date.now(),
    ...overrides
  })

  describe('formatCommentForDisplay', () => {
    it('should format a comment with short text correctly', () => {
      const { result } = renderHook(() => useReviewComments())
      const comment = createMockComment()
      
      const formatted = result.current.formatCommentForDisplay(comment)
      
      expect(formatted.fileName).toBe('Example.tsx')
      expect(formatted.lineText).toBe('Lines 10-15')
      expect(formatted.sideText).toBe('current')
      expect(formatted.commentPreview).toBe('This is a test comment')
      expect(formatted.fullComment).toBe('This is a test comment')
    })

    it('should truncate long comments in preview', () => {
      const { result } = renderHook(() => useReviewComments())
      const longComment = 'This is a very long comment that should be truncated in the preview to keep the UI clean'
      const comment = createMockComment({ comment: longComment })
      
      const formatted = result.current.formatCommentForDisplay(comment)
      
      expect(formatted.commentPreview).toBe('This is a very long comment that should be truncat...')
      expect(formatted.fullComment).toBe(longComment)
    })

    it('should handle single line ranges', () => {
      const { result } = renderHook(() => useReviewComments())
      const comment = createMockComment({ lineRange: { start: 10, end: 10 } })
      
      const formatted = result.current.formatCommentForDisplay(comment)
      
      expect(formatted.lineText).toBe('Line 10')
    })

    it('should handle old/base side correctly', () => {
      const { result } = renderHook(() => useReviewComments())
      const comment = createMockComment({ side: 'old' })
      
      const formatted = result.current.formatCommentForDisplay(comment)
      
      expect(formatted.sideText).toBe('base')
    })

    it('should handle file paths without directories', () => {
      const { result } = renderHook(() => useReviewComments())
      const comment = createMockComment({ filePath: 'Example.tsx' })
      
      const formatted = result.current.formatCommentForDisplay(comment)
      
      expect(formatted.fileName).toBe('Example.tsx')
    })
  })

  describe('formatCommentsForDisplay', () => {
    it('should format multiple comments', () => {
      const { result } = renderHook(() => useReviewComments())
      const comments = [
        createMockComment({ id: '1' }),
        createMockComment({ id: '2', filePath: 'src/utils/helper.ts' }),
        createMockComment({ id: '3', side: 'old' })
      ]
      
      const formatted = result.current.formatCommentsForDisplay(comments)
      
      expect(formatted).toHaveLength(3)
      expect(formatted[0].fileName).toBe('Example.tsx')
      expect(formatted[1].fileName).toBe('helper.ts')
      expect(formatted[2].sideText).toBe('base')
    })
  })

  describe('formatReviewForPrompt', () => {
    it('should format review comments for prompt', () => {
      const { result } = renderHook(() => useReviewComments())
      const comments = [
        createMockComment({
          filePath: 'src/App.tsx',
          lineRange: { start: 5, end: 10 },
          selectedText: 'const app = () => {}',
          comment: 'Consider using a more descriptive name'
        })
      ]
      
      const formatted = result.current.formatReviewForPrompt(comments)
      
      expect(formatted).toContain('# Code Review Comments')
      expect(formatted).toContain('## src/App.tsx')
      expect(formatted).toContain('### Lines 5-10 (current):')
      expect(formatted).toContain('const app = () => {}')
      expect(formatted).toContain('**Comment:** Consider using a more descriptive name')
    })

    it('should group comments by file', () => {
      const { result } = renderHook(() => useReviewComments())
      const comments = [
        createMockComment({ filePath: 'file1.ts', comment: 'Comment 1' }),
        createMockComment({ filePath: 'file2.ts', comment: 'Comment 2' }),
        createMockComment({ filePath: 'file1.ts', comment: 'Comment 3' })
      ]
      
      const formatted = result.current.formatReviewForPrompt(comments)
      
      expect(formatted).toContain('## file1.ts')
      expect(formatted).toContain('## file2.ts')
      expect(formatted).toContain('Comment 1')
      expect(formatted).toContain('Comment 2')
      expect(formatted).toContain('Comment 3')
    })

    it('should handle old/base side in prompt format', () => {
      const { result } = renderHook(() => useReviewComments())
      const comments = [
        createMockComment({ side: 'old' })
      ]
      
      const formatted = result.current.formatReviewForPrompt(comments)
      
      expect(formatted).toContain('(base):')
    })
  })

  describe('getConfirmationMessage', () => {
    it('should handle singular comment', () => {
      const { result } = renderHook(() => useReviewComments())
      
      const message = result.current.getConfirmationMessage(1)
      
      expect(message).toBe('Cancel review and discard 1 comment?')
    })

    it('should handle plural comments', () => {
      const { result } = renderHook(() => useReviewComments())
      
      const message = result.current.getConfirmationMessage(5)
      
      expect(message).toBe('Cancel review and discard 5 comments?')
    })
  })

  describe('groupCommentsByFile', () => {
    it('should group comments by file path', () => {
      const { result } = renderHook(() => useReviewComments())
      const comments = [
        createMockComment({ id: '1', filePath: 'file1.ts' }),
        createMockComment({ id: '2', filePath: 'file2.ts' }),
        createMockComment({ id: '3', filePath: 'file1.ts' }),
        createMockComment({ id: '4', filePath: 'file2.ts' }),
        createMockComment({ id: '5', filePath: 'file3.ts' })
      ]
      
      const grouped = result.current.groupCommentsByFile(comments)
      
      expect(grouped.size).toBe(3)
      expect(grouped.get('file1.ts')).toHaveLength(2)
      expect(grouped.get('file2.ts')).toHaveLength(2)
      expect(grouped.get('file3.ts')).toHaveLength(1)
    })

    it('should handle empty comments array', () => {
      const { result } = renderHook(() => useReviewComments())
      
      const grouped = result.current.groupCommentsByFile([])
      
      expect(grouped.size).toBe(0)
    })
  })
})