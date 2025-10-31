import { memo } from 'react'
import { theme } from '../../common/theme'

interface ProgressIndicatorProps {
    className?: string
    size?: 'sm' | 'md' | 'lg'
}

export const ProgressIndicator = memo<ProgressIndicatorProps>(({
    className = '',
    size = 'sm'
}) => {
    const sizeClasses = {
        sm: 'h-3.5',
        md: 'h-4',
        lg: 'h-5'
    }

    const dotSizes = {
        sm: 'w-1 h-1',
        md: 'w-1.5 h-1.5',
        lg: 'w-2 h-2'
    }

    return (
        <div className={`inline-flex items-center ${className}`}>
            <style>{`
                @keyframes progress-pulse {
                    0%, 100% {
                        opacity: 0.4;
                        transform: scale(0.85);
                    }
                    50% {
                        opacity: 1;
                        transform: scale(1.15);
                    }
                }

                .progress-dot-1 {
                    animation: progress-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) infinite;
                }

                .progress-dot-2 {
                    animation: progress-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) 0.3s infinite;
                }

                .progress-dot-3 {
                    animation: progress-pulse 1.8s cubic-bezier(0.4, 0, 0.6, 1) 0.6s infinite;
                }
            `}</style>

            <div className={`flex items-center gap-0.5 ${sizeClasses[size]}`}>
                <div
                    className={`${dotSizes[size]} rounded-full progress-dot-1`}
                    style={{ backgroundColor: theme.colors.accent.blue.DEFAULT }}
                />
                <div
                    className={`${dotSizes[size]} rounded-full progress-dot-2`}
                    style={{ backgroundColor: theme.colors.accent.blue.DEFAULT }}
                />
                <div
                    className={`${dotSizes[size]} rounded-full progress-dot-3`}
                    style={{ backgroundColor: theme.colors.accent.blue.DEFAULT }}
                />
            </div>
        </div>
    )
})

ProgressIndicator.displayName = 'ProgressIndicator'
