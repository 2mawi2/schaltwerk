import React from 'react'
import { theme } from '../../common/theme'

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
  const sizeClasses = {
    sm: 'w-4 h-4',
    md: 'w-8 h-8',
    lg: 'w-12 h-12'
  }

  const textSizeClasses = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-lg'
  }

  return (
    <div className={`flex flex-col items-center justify-center space-y-4 ${className}`}>
      <div className="relative">
        {/* Outer ring */}
        <div
          className={`${sizeClasses[size]} rounded-full border-2 animate-spin`}
          style={{
            borderColor: `${theme.colors.accent.blue.DEFAULT}33`,
            borderTopColor: theme.colors.accent.blue.DEFAULT
          }}
        />
        {/* Inner ring for layered effect */}
        <div
          className={`absolute inset-1 ${size === 'sm' ? 'w-2 h-2' : size === 'md' ? 'w-6 h-6' : 'w-10 h-10'} rounded-full border-2 animate-spin`}
          style={{
            borderColor: `${theme.colors.accent.blue.light}22`,
            borderTopColor: theme.colors.accent.blue.light,
            animationDirection: 'reverse',
            animationDuration: '1.5s'
          }}
        />
      </div>
      {message && (
        <p
          className={`${textSizeClasses[size]} font-medium animate-pulse`}
          style={{ color: theme.colors.text.secondary }}
        >
          {message}
        </p>
      )}
    </div>
  )
}