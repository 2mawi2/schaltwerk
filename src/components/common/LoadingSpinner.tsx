import React from 'react'
import { AnimatedText } from './AnimatedText'

interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  message?: string
  className?: string
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  size = 'md',
  message = 'Loading...',
  className = ''
}) => {
  const animatedTextSize = size === 'sm' ? 'xs' : size === 'lg' ? 'lg' : 'md'

  return (
    <div className={`flex flex-col items-center justify-center ${className}`}>
      <AnimatedText 
        text={message.toLowerCase().replace(/[^\w\s]/g, '')} 
        colorClassName="text-slate-500"
        size={animatedTextSize}
      />
    </div>
  )
}