import { VscCommentDiscussion } from 'react-icons/vsc'
import type { CSSProperties } from 'react'

interface FeedbackButtonProps {
  onClick: () => void
}

const buttonStyle: CSSProperties = {
  pointerEvents: 'auto',
}

export function FeedbackButton({ onClick }: FeedbackButtonProps) {
  return (
    <button
      onClick={onClick}
      className="h-6 w-6 inline-flex items-center justify-center rounded text-text-tertiary hover:text-text-secondary hover:bg-bg-elevated/50 transition-colors mr-2"
      title="Send feedback"
      aria-label="Send feedback"
      data-no-drag
      style={buttonStyle}
    >
      <VscCommentDiscussion className="text-[14px]" />
    </button>
  )
}
