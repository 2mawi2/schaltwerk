import React from 'react'
import { theme } from '../common/theme'
import { ResizableModal } from './shared/ResizableModal'

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
    <ResizableModal
      isOpen={true}
      onClose={onClose}
      title={specName}
      storageKey="spec-content"
      defaultWidth={900}
      defaultHeight={600}
      minWidth={500}
      minHeight={400}
    >
      <div className="p-6">
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
    </ResizableModal>
  )
}
