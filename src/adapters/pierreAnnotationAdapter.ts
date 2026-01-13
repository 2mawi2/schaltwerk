import type { DiffLineAnnotation, AnnotationSide } from '@pierre/diffs'
import type { ReviewComment, ReviewCommentThread } from '../types/review'

export interface PierreAnnotationMetadata {
  commentId: string
  threadId?: string
  isRangeStart: boolean
  isRangeEnd: boolean
  rangeLength: number
  comment: ReviewComment
}

function convertSide(side: 'old' | 'new'): AnnotationSide {
  return side === 'old' ? 'deletions' : 'additions'
}

export function convertCommentToAnnotations(
  comment: ReviewComment
): DiffLineAnnotation<PierreAnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<PierreAnnotationMetadata>[] = []
  const pierreSide = convertSide(comment.side)
  const rangeLength = comment.lineRange.end - comment.lineRange.start + 1

  annotations.push({
    side: pierreSide,
    lineNumber: comment.lineRange.start,
    metadata: {
      commentId: comment.id,
      isRangeStart: true,
      isRangeEnd: rangeLength === 1,
      rangeLength,
      comment,
    },
  })

  for (let i = comment.lineRange.start + 1; i <= comment.lineRange.end; i++) {
    annotations.push({
      side: pierreSide,
      lineNumber: i,
      metadata: {
        commentId: comment.id,
        isRangeStart: false,
        isRangeEnd: i === comment.lineRange.end,
        rangeLength,
        comment,
      },
    })
  }

  return annotations
}

export function convertCommentsToAnnotations(
  comments: ReviewComment[]
): DiffLineAnnotation<PierreAnnotationMetadata>[] {
  return comments.flatMap(convertCommentToAnnotations)
}

export function convertThreadToAnnotations(
  thread: ReviewCommentThread
): DiffLineAnnotation<PierreAnnotationMetadata>[] {
  const annotations: DiffLineAnnotation<PierreAnnotationMetadata>[] = []
  const pierreSide = convertSide(thread.side)

  if (thread.comments.length === 0) return annotations

  const firstComment = thread.comments[0]
  const rangeLength = thread.lineRange.end - thread.lineRange.start + 1

  annotations.push({
    side: pierreSide,
    lineNumber: thread.lineRange.start,
    metadata: {
      commentId: firstComment.id,
      threadId: thread.id,
      isRangeStart: true,
      isRangeEnd: rangeLength === 1,
      rangeLength,
      comment: firstComment,
    },
  })

  for (let i = thread.lineRange.start + 1; i <= thread.lineRange.end; i++) {
    annotations.push({
      side: pierreSide,
      lineNumber: i,
      metadata: {
        commentId: firstComment.id,
        threadId: thread.id,
        isRangeStart: false,
        isRangeEnd: i === thread.lineRange.end,
        rangeLength,
        comment: firstComment,
      },
    })
  }

  return annotations
}

export function convertThreadsToAnnotations(
  threads: ReviewCommentThread[]
): DiffLineAnnotation<PierreAnnotationMetadata>[] {
  return threads.flatMap(convertThreadToAnnotations)
}

export function groupAnnotationsByLine(
  annotations: DiffLineAnnotation<PierreAnnotationMetadata>[]
): Map<string, DiffLineAnnotation<PierreAnnotationMetadata>[]> {
  const grouped = new Map<string, DiffLineAnnotation<PierreAnnotationMetadata>[]>()

  for (const annotation of annotations) {
    const key = `${annotation.side}-${annotation.lineNumber}`
    const existing = grouped.get(key) ?? []
    existing.push(annotation)
    grouped.set(key, existing)
  }

  return grouped
}
