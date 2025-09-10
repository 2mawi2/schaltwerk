import { useState, useEffect, useCallback, useRef } from 'react'
import { VscInfo, VscSend } from 'react-icons/vsc'
import { analytics, AnalyticsEventName } from '../../analytics'
import { getVersion } from '@tauri-apps/api/app'
import { logger } from '../../utils/logger'
import { theme } from '../../common/theme'

interface FeedbackModalProps {
  open: boolean
  onClose: () => void
}

export function FeedbackModal({ open, onClose }: FeedbackModalProps) {
  const [feedback, setFeedback] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [status, setStatus] = useState<'idle' | 'success' | 'error' | 'no-consent'>('idle')
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  
  const MAX_LENGTH = 1000
  const MIN_LENGTH = 10
  
  const isValid = feedback.trim().length >= MIN_LENGTH && feedback.length <= MAX_LENGTH

  const handleSubmit = useCallback(async () => {
    if (!isValid || isSubmitting) return
    
    if (!analytics.isConsentGiven()) {
      setStatus('no-consent')
      return
    }
    
    setIsSubmitting(true)
    setStatus('idle')
    
    try {
      const version = await getVersion()
      
      analytics.track(AnalyticsEventName.USER_FEEDBACK, {
        message: feedback.trim(),
        version,
      })
      
      setStatus('success')
      setFeedback('')
      
      setTimeout(() => {
        onClose()
      }, 2000)
    } catch (error) {
      logger.error('Failed to send feedback', error)
      setStatus('error')
    } finally {
      setIsSubmitting(false)
    }
  }, [feedback, isValid, isSubmitting, onClose])

  // No keyboard shortcuts for submit to avoid interference with other app shortcuts

  useEffect(() => {
    if (!open) {
      setFeedback('')
      setStatus('idle')
      setIsSubmitting(false)
      return
    }

    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        onClose()
      }
    }

    window.addEventListener('keydown', handleEscape, true)
    
    const timer = setTimeout(() => {
      textareaRef.current?.focus()
    }, 0)
    
    return () => {
      window.removeEventListener('keydown', handleEscape, true)
      clearTimeout(timer)
    }
  }, [open, onClose])

  if (!open) return null

  return (
    <div 
      className="fixed inset-0 flex items-center justify-center z-50" 
      role="dialog" 
      aria-modal="true"
      style={{ backgroundColor: 'rgba(0, 0, 0, 0.5)' }}
    >
      <div 
        className="border rounded-lg p-6 max-w-lg w-full mx-4"
        style={{
          backgroundColor: theme.colors.background.secondary,
          borderColor: theme.colors.border.subtle,
        }}
      >
        <h2 
          className="text-lg font-semibold mb-4"
          style={{ color: theme.colors.text.primary }}
        >
          Send Feedback
        </h2>
        
        <div className="mb-4">
          <textarea
            ref={textareaRef}
            value={feedback}
            onChange={(e) => setFeedback(e.target.value.slice(0, MAX_LENGTH))}
            placeholder="Share your feedback, suggestions, or report issues..."
            className="w-full p-3 rounded-md border resize-none focus:outline-none focus:ring-2"
            style={{
              backgroundColor: theme.colors.background.primary,
              borderColor: theme.colors.border.subtle,
              color: theme.colors.text.primary,
              minHeight: '120px',
            }}
            rows={5}
            maxLength={MAX_LENGTH}
          />
          
          <div className="flex items-center justify-between mt-2">
            <div 
              className="flex items-center gap-1.5 text-xs"
              style={{ color: theme.colors.text.tertiary }}
            >
              <VscInfo className="text-xs" />
              <span>Feedback is stored anonymously on PostHog</span>
            </div>
            
            <span 
              className="text-xs"
              style={{ 
                color: feedback.length > MAX_LENGTH * 0.9 
                  ? theme.colors.accent.amber.DEFAULT 
                  : theme.colors.text.tertiary 
              }}
            >
              {feedback.length} / {MAX_LENGTH}
            </span>
          </div>
        </div>

        {status === 'success' && (
          <div 
            className="mb-4 p-3 rounded-md"
            style={{
              backgroundColor: `${theme.colors.accent.green.DEFAULT}20`,
              color: theme.colors.accent.green.light,
            }}
          >
            Thank you for your feedback! We appreciate your input.
          </div>
        )}

        {status === 'error' && (
          <div 
            className="mb-4 p-3 rounded-md"
            style={{
              backgroundColor: `${theme.colors.accent.red.DEFAULT}20`,
              color: theme.colors.accent.red.light,
            }}
          >
            Failed to send feedback. Please try again later.
          </div>
        )}

        {status === 'no-consent' && (
          <div 
            className="mb-4 p-3 rounded-md"
            style={{
              backgroundColor: `${theme.colors.accent.amber.DEFAULT}20`,
              color: theme.colors.accent.amber.light,
            }}
          >
            Analytics must be enabled to send feedback. You can enable it in Settings → Privacy.
          </div>
        )}

        <div className="flex gap-3 justify-end">
          <button
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium border rounded-md hover:opacity-80 focus:outline-none focus:ring-2 group"
            style={{
              color: theme.colors.text.secondary,
              backgroundColor: theme.colors.background.elevated,
              borderColor: theme.colors.border.subtle,
            }}
            title="Cancel (Esc)"
          >
            Cancel
            <span className="ml-1.5 text-xs opacity-60 group-hover:opacity-100">Esc</span>
          </button>
          
          <button
            onClick={handleSubmit}
            disabled={!isValid || isSubmitting}
            className="px-4 py-2 text-sm font-medium rounded-md focus:outline-none focus:ring-2 group disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center gap-2"
            style={{
              color: 'white',
              backgroundColor: isValid && !isSubmitting 
                ? theme.colors.accent.blue.DEFAULT 
                : theme.colors.border.default,
            }}
            title={isValid ? "Send Feedback" : `Minimum ${MIN_LENGTH} characters required`}
          >
            <VscSend className="text-sm" />
            <span>{isSubmitting ? 'Sending...' : 'Send Feedback'}</span>
          </button>
        </div>
      </div>
    </div>
  )
}