import React from 'react'
import { AnimatedText } from './AnimatedText'
import { useTranslation } from '../../common/i18n'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  message?: string
  className?: string
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  message,
  className = ''
}) => {
  const { t } = useTranslation()
  const displayMessage = message ?? t.loadingSpinner.loading
  const animatedTextSize = size === 'sm' ? 'xs' as const : size === 'lg' ? 'lg' as const : undefined

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <AnimatedText
        text={displayMessage.toLowerCase().replace(/[^\w\s]/g, '')}
        size={animatedTextSize}
      />
    </div>
  )
}
