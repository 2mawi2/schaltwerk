import { createContext, useContext, useState, ReactNode } from 'react'
import { SpecReviewComment, SpecReviewSession } from '../types/specReview'

interface SpecReviewContextType {
  currentReview: SpecReviewSession | null
  addComment: (comment: Omit<SpecReviewComment, 'id' | 'timestamp'>) => void
  removeComment: (id: string) => void
  updateComment: (id: string, text: string) => void
  clearReview: () => void
  startReview: (specId: string, specDisplayName: string) => void
}

const SpecReviewContext = createContext<SpecReviewContextType | undefined>(undefined)

export function SpecReviewProvider({ children }: { children: ReactNode }) {
  const [currentReview, setCurrentReview] = useState<SpecReviewSession | null>(null)

  const startReview = (specId: string, specDisplayName: string) => {
    setCurrentReview({
      comments: [],
      specId,
      specDisplayName,
      createdAt: Date.now()
    })
  }

  const addComment = (comment: Omit<SpecReviewComment, 'id' | 'timestamp'>) => {
    if (!currentReview) return

    const newComment: SpecReviewComment = {
      ...comment,
      id: crypto.randomUUID(),
      timestamp: Date.now()
    }

    setCurrentReview({
      ...currentReview,
      comments: [...currentReview.comments, newComment]
    })
  }

  const removeComment = (id: string) => {
    if (!currentReview) return

    setCurrentReview({
      ...currentReview,
      comments: currentReview.comments.filter(c => c.id !== id)
    })
  }

  const updateComment = (id: string, text: string) => {
    if (!currentReview) return

    setCurrentReview({
      ...currentReview,
      comments: currentReview.comments.map(c =>
        c.id === id ? { ...c, comment: text } : c
      )
    })
  }

  const clearReview = () => {
    setCurrentReview(null)
  }

  return (
    <SpecReviewContext.Provider value={{
      currentReview,
      addComment,
      removeComment,
      updateComment,
      clearReview,
      startReview
    }}>
      {children}
    </SpecReviewContext.Provider>
  )
}

export function useSpecReview() {
  const context = useContext(SpecReviewContext)
  if (!context) {
    throw new Error('useSpecReview must be used within a SpecReviewProvider')
  }
  return context
}
