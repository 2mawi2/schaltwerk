import React from 'react'
import { theme } from '../common/theme'

interface SpecContentModalProps {
  specName: string
  content: string
  onClose: () => void
}

export const SpecContentModal: React.FC<SpecContentModalProps> = ({
  specName,
  content,
  onClose
}) => {
  return (
    <div 
      className="fixed inset-0 z-[70] flex items-center justify-center p-4"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.8)' }}
      onClick={onClose}
    >
      <div 
        className="relative max-w-4xl w-full max-h-[80vh] flex flex-col rounded-lg shadow-2xl"
        style={{ 
          backgroundColor: theme.colors.background.elevated,
          border: `1px solid ${theme.colors.border.subtle}`
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div 
          className="flex items-center justify-between px-6 py-4"
          style={{ 
            borderBottom: `1px solid ${theme.colors.border.subtle}`,
            backgroundColor: theme.colors.background.secondary
          }}
        >
          <h2 
            className="font-semibold"
            style={{ 
              fontSize: theme.fontSize.headingLarge,
              color: theme.colors.text.primary 
            }}
          >
            {specName}
          </h2>
          <button
            onClick={onClose}
            className="p-1 rounded transition-colors hover:bg-opacity-10"
            style={{ 
              color: theme.colors.text.secondary,
              backgroundColor: 'transparent'
            }}
            onMouseEnter={(e) => e.currentTarget.style.backgroundColor = theme.colors.background.hover}
            onMouseLeave={(e) => e.currentTarget.style.backgroundColor = 'transparent'}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        
        <div className="flex-1 overflow-y-auto p-6">
          <pre 
            className="whitespace-pre-wrap font-mono"
            style={{ 
              fontSize: theme.fontSize.code,
              color: theme.colors.text.primary,
              lineHeight: '1.6'
            }}
          >
            {content || 'No content available'}
          </pre>
        </div>
      </div>
    </div>
  )
}