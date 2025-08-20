import { useCallback } from 'react'
import { ReviewComment } from '../types/review'

export interface CommentDisplay {
  id: string
  fileName: string
  lineText: string
  sideText: string
  commentPreview: string
  fullComment: string
  filePath: string
  lineRange: {
    start: number
    end: number
  }
  side: 'old' | 'new'
}

export function useReviewComments() {
  const formatCommentForDisplay = useCallback((comment: ReviewComment): CommentDisplay => {
    const fileName = comment.filePath.split('/').pop() || comment.filePath
    const lineText = comment.lineRange.start === comment.lineRange.end 
      ? `Line ${comment.lineRange.start}`
      : `Lines ${comment.lineRange.start}-${comment.lineRange.end}`
    const sideText = comment.side === 'old' ? 'base' : 'current'
    const commentPreview = comment.comment.length > 50 
      ? comment.comment.substring(0, 50) + '...'
      : comment.comment
    
    return {
      id: comment.id,
      fileName,
      lineText,
      sideText,
      commentPreview,
      fullComment: comment.comment,
      filePath: comment.filePath,
      lineRange: comment.lineRange,
      side: comment.side
    }
  }, [])

  const formatCommentsForDisplay = useCallback((comments: ReviewComment[]): CommentDisplay[] => {
    return comments.map(formatCommentForDisplay)
  }, [formatCommentForDisplay])

  const formatReviewForPrompt = useCallback((comments: ReviewComment[]) => {
    let output = '\n# Code Review Comments\n\n'
    
    const commentsByFile = comments.reduce((acc, comment) => {
      if (!acc[comment.filePath]) {
        acc[comment.filePath] = []
      }
      acc[comment.filePath].push(comment)
      return acc
    }, {} as Record<string, ReviewComment[]>)

    for (const [file, fileComments] of Object.entries(commentsByFile)) {
      output += `## ${file}\n\n`
      
      for (const comment of fileComments) {
        output += `### Lines ${comment.lineRange.start}-${comment.lineRange.end} (${comment.side === 'old' ? 'base' : 'current'}):\n`
        output += `\`\`\`\n${comment.selectedText}\n\`\`\`\n`
        output += `**Comment:** ${comment.comment}\n\n`
      }
    }

    return output
  }, [])

  const getConfirmationMessage = useCallback((commentCount: number): string => {
    return `Cancel review and discard ${commentCount} comment${commentCount > 1 ? 's' : ''}?`
  }, [])

  const groupCommentsByFile = useCallback((comments: ReviewComment[]): Map<string, ReviewComment[]> => {
    const grouped = new Map<string, ReviewComment[]>()
    
    for (const comment of comments) {
      const existing = grouped.get(comment.filePath) || []
      existing.push(comment)
      grouped.set(comment.filePath, existing)
    }
    
    return grouped
  }, [])

  return {
    formatCommentForDisplay,
    formatCommentsForDisplay,
    formatReviewForPrompt,
    getConfirmationMessage,
    groupCommentsByFile
  }
}