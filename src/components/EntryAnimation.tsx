import React from 'react'

interface EntryAnimationProps {
  children: React.ReactNode
}

export const EntryAnimation: React.FC<EntryAnimationProps> = ({ children }) => {
  return (
    <div
      data-testid="entry-animation-content"
      className="h-screen w-screen"
    >
      {children}
    </div>
  )
}
