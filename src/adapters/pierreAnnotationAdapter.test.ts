import { describe, it, expect } from 'vitest'
import { getLineAnnotationName } from '@pierre/diffs'
import {
  convertCommentToAnnotations,
  convertThreadsToAnnotations,
  groupAnnotationsByLine,
  type PierreAnnotationMetadata,
} from './pierreAnnotationAdapter'
import type { ReviewComment, ReviewCommentThread } from '../types/review'

describe('pierreAnnotationAdapter', () => {
  describe('convertCommentToAnnotations', () => {
    it('converts a single-line comment to one annotation', () => {
      const comment: ReviewComment = {
        id: 'c1',
        filePath: 'test.ts',
        lineRange: { start: 5, end: 5 },
        side: 'new',
        selectedText: 'const x = 1',
        comment: 'Good variable name',
        timestamp: Date.now(),
      }

      const annotations = convertCommentToAnnotations(comment)

      expect(annotations).toHaveLength(1)
      expect(annotations[0]).toEqual({
        side: 'additions',
        lineNumber: 5,
        metadata: {
          commentId: 'c1',
          isRangeStart: true,
          isRangeEnd: true,
          rangeLength: 1,
          comment,
        },
      })
    })

    it('converts a multi-line comment to multiple annotations', () => {
      const comment: ReviewComment = {
        id: 'c2',
        filePath: 'test.ts',
        lineRange: { start: 10, end: 12 },
        side: 'old',
        selectedText: 'line1\nline2\nline3',
        comment: 'These lines need refactoring',
        timestamp: Date.now(),
      }

      const annotations = convertCommentToAnnotations(comment)

      expect(annotations).toHaveLength(3)
      expect(annotations[0].side).toBe('deletions')
      expect(annotations[0].lineNumber).toBe(10)
      expect(annotations[0].metadata?.isRangeStart).toBe(true)
      expect(annotations[0].metadata?.isRangeEnd).toBe(false)

      expect(annotations[1].lineNumber).toBe(11)
      expect(annotations[1].metadata?.isRangeStart).toBe(false)
      expect(annotations[1].metadata?.isRangeEnd).toBe(false)

      expect(annotations[2].lineNumber).toBe(12)
      expect(annotations[2].metadata?.isRangeStart).toBe(false)
      expect(annotations[2].metadata?.isRangeEnd).toBe(true)
    })

    it('maps old side to deletions and new side to additions', () => {
      const oldComment: ReviewComment = {
        id: 'c3',
        filePath: 'test.ts',
        lineRange: { start: 1, end: 1 },
        side: 'old',
        selectedText: 'x',
        comment: 'old comment',
        timestamp: Date.now(),
      }

      const newComment: ReviewComment = {
        id: 'c4',
        filePath: 'test.ts',
        lineRange: { start: 1, end: 1 },
        side: 'new',
        selectedText: 'y',
        comment: 'new comment',
        timestamp: Date.now(),
      }

      expect(convertCommentToAnnotations(oldComment)[0].side).toBe('deletions')
      expect(convertCommentToAnnotations(newComment)[0].side).toBe('additions')
    })
  })

  describe('convertThreadsToAnnotations', () => {
    it('returns empty array for empty threads', () => {
      expect(convertThreadsToAnnotations([])).toEqual([])
    })

    it('returns empty array for thread with no comments', () => {
      const thread: ReviewCommentThread = {
        id: 't1',
        filePath: 'test.ts',
        side: 'new',
        lineRange: { start: 1, end: 1 },
        comments: [],
      }

      expect(convertThreadsToAnnotations([thread])).toEqual([])
    })

    it('converts thread with comments to annotations', () => {
      const comment: ReviewComment = {
        id: 'c1',
        filePath: 'test.ts',
        lineRange: { start: 5, end: 5 },
        side: 'new',
        selectedText: 'x',
        comment: 'First comment',
        timestamp: Date.now(),
      }

      const thread: ReviewCommentThread = {
        id: 't1',
        filePath: 'test.ts',
        side: 'new',
        lineRange: { start: 5, end: 5 },
        comments: [comment],
      }

      const annotations = convertThreadsToAnnotations([thread])

      expect(annotations).toHaveLength(1)
      expect(annotations[0].side).toBe('additions')
      expect(annotations[0].lineNumber).toBe(5)
      expect(annotations[0].metadata?.threadId).toBe('t1')
      expect(annotations[0].metadata?.isRangeStart).toBe(true)
    })
  })

  describe('groupAnnotationsByLine', () => {
    it('groups annotations by side and line number', () => {
      const annotations = [
        { side: 'additions' as const, lineNumber: 5, metadata: { commentId: 'c1' } as PierreAnnotationMetadata },
        { side: 'additions' as const, lineNumber: 5, metadata: { commentId: 'c2' } as PierreAnnotationMetadata },
        { side: 'deletions' as const, lineNumber: 5, metadata: { commentId: 'c3' } as PierreAnnotationMetadata },
        { side: 'additions' as const, lineNumber: 10, metadata: { commentId: 'c4' } as PierreAnnotationMetadata },
      ]

      const grouped = groupAnnotationsByLine(annotations)

      expect(grouped.get('additions-5')).toHaveLength(2)
      expect(grouped.get('deletions-5')).toHaveLength(1)
      expect(grouped.get('additions-10')).toHaveLength(1)
    })
  })

  describe('slot name compatibility with Pierre', () => {
    it('generates slot names that match Pierre getLineAnnotationName format', () => {
      const comment: ReviewComment = {
        id: 'c1',
        filePath: 'test.ts',
        lineRange: { start: 5, end: 5 },
        side: 'new',
        selectedText: 'x',
        comment: 'test',
        timestamp: Date.now(),
      }

      const annotations = convertCommentToAnnotations(comment)
      const annotation = annotations[0]

      const pierreSlotName = getLineAnnotationName(annotation)
      expect(pierreSlotName).toBe('annotation-additions-5')
    })

    it('generates correct slot names for old side comments', () => {
      const comment: ReviewComment = {
        id: 'c2',
        filePath: 'test.ts',
        lineRange: { start: 10, end: 10 },
        side: 'old',
        selectedText: 'y',
        comment: 'test old',
        timestamp: Date.now(),
      }

      const annotations = convertCommentToAnnotations(comment)
      const annotation = annotations[0]

      const pierreSlotName = getLineAnnotationName(annotation)
      expect(pierreSlotName).toBe('annotation-deletions-10')
    })

    it('generates unique slot names for each line in multi-line comments', () => {
      const comment: ReviewComment = {
        id: 'c3',
        filePath: 'test.ts',
        lineRange: { start: 1, end: 3 },
        side: 'new',
        selectedText: 'multi',
        comment: 'test multi',
        timestamp: Date.now(),
      }

      const annotations = convertCommentToAnnotations(comment)

      expect(annotations).toHaveLength(3)
      expect(getLineAnnotationName(annotations[0])).toBe('annotation-additions-1')
      expect(getLineAnnotationName(annotations[1])).toBe('annotation-additions-2')
      expect(getLineAnnotationName(annotations[2])).toBe('annotation-additions-3')
    })
  })
})
