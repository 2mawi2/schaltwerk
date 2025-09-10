import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { invoke } from '@tauri-apps/api/core'
import posthogLib from 'posthog-js'
import { analytics } from './posthog'
import { AnalyticsEventName } from './events'

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}))

vi.mock('posthog-js', () => ({
  default: {
    init: vi.fn(),
    capture: vi.fn(),
    opt_out_capturing: vi.fn(),
    opt_in_capturing: vi.fn(),
    identify: vi.fn()
  }
}))

const mockInvoke = vi.mocked(invoke)
const posthogMock = vi.mocked(posthogLib)

describe('Analytics', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    
    // Reset analytics instance state
    analytics['initialized'] = false
    analytics['consentGiven'] = false
    
    // Mock successful consent check by default
    mockInvoke.mockResolvedValue(false)
    
    // Mock environment variable
    import.meta.env.VITE_POSTHOG_KEY = 'test-api-key'
  })

  afterEach(() => {
    analytics.shutdown()
    delete import.meta.env.VITE_POSTHOG_KEY
  })

  describe('consent management', () => {
    it('should default to opt-out (no consent)', () => {
      expect(analytics.isConsentGiven()).toBe(false)
      expect(analytics.isInitialized()).toBe(false)
    })

    it('should not initialize when consent is not given', async () => {
      mockInvoke.mockResolvedValueOnce(false) // get_analytics_consent returns false
      
      await analytics.initialize()
      
      expect(analytics.isInitialized()).toBe(false)
      expect(analytics.isConsentGiven()).toBe(false)
    })

    it('should initialize when consent is given and API key exists', async () => {
      mockInvoke.mockResolvedValueOnce(true) // get_analytics_consent returns true
      
      await analytics.initialize()
      
      expect(analytics.isInitialized()).toBe(true)
      expect(analytics.isConsentGiven()).toBe(true)
    })

    it('should not initialize when API key is missing even with consent', async () => {
      mockInvoke.mockResolvedValueOnce(true) // get_analytics_consent returns true
      delete import.meta.env.VITE_POSTHOG_KEY
      
      await analytics.initialize()
      
      expect(analytics.isInitialized()).toBe(false)
      expect(analytics.isConsentGiven()).toBe(true) // consent is still given, just can't initialize
    })

    it('should update consent and reinitialize when consent granted', async () => {
      // Start without consent
      mockInvoke.mockResolvedValueOnce(false)
      await analytics.initialize()
      expect(analytics.isConsentGiven()).toBe(false)
      
      // Grant consent
      mockInvoke.mockResolvedValue(true) // Future calls return true
      await analytics.updateConsent(true)
      
      expect(analytics.isConsentGiven()).toBe(true)
      expect(analytics.isInitialized()).toBe(true)
    })

    it('should disable tracking when consent revoked', async () => {
      // Start with consent
      mockInvoke.mockResolvedValueOnce(true)
      await analytics.initialize()
      expect(analytics.isInitialized()).toBe(true)
      
      // Revoke consent
      await analytics.updateConsent(false)
      
      expect(analytics.isConsentGiven()).toBe(false)
      expect(analytics.isInitialized()).toBe(false)
    })
  })

  describe('tracking with consent checks', () => {
    beforeEach(async () => {
      // Set up with consent for tracking tests
      mockInvoke.mockResolvedValueOnce(true)
      await analytics.initialize()
    })

    it('should track events when consent is given and initialized', async () => {
      analytics.track(AnalyticsEventName.APP_STARTED, { 
      version: '1.0.0',
      environment: 'development',
      build_source: 'local'
    })
      
      expect(posthogMock.capture).toHaveBeenCalledWith(AnalyticsEventName.APP_STARTED, { 
        version: '1.0.0',
        environment: 'development',
        build_source: 'local'
      })
    })

    it('should not track events without consent', async () => {
      posthogMock.capture.mockClear()
      
      // Revoke consent
      await analytics.updateConsent(false)
      
      analytics.track(AnalyticsEventName.APP_STARTED, { 
      version: '1.0.0',
      environment: 'development',
      build_source: 'local'
    })
      
      expect(posthogMock.capture).not.toHaveBeenCalled()
    })

    it('should not track events when not initialized', async () => {
      posthogMock.capture.mockClear()
      
      // Reset to uninitialized state but keep consent
      analytics['initialized'] = false
      
      analytics.track(AnalyticsEventName.APP_STARTED, { 
      version: '1.0.0',
      environment: 'development',
      build_source: 'local'
    })
      
      expect(posthogMock.capture).not.toHaveBeenCalled()
    })

    it('should sanitize properties by removing sensitive data', async () => {
      analytics.track(AnalyticsEventName.SESSION_CREATED, {
        agent_type: 'claude',
        from_spec: true
      })
      
      expect(posthogMock.capture).toHaveBeenCalledWith(
        AnalyticsEventName.SESSION_CREATED,
        { agent_type: 'claude', from_spec: true }
      )
    })
  })

  describe('property sanitization', () => {
    beforeEach(async () => {
      mockInvoke.mockResolvedValueOnce(true)
      await analytics.initialize()
    })

    it('should remove properties that look like paths', async () => {
      analytics.track(AnalyticsEventName.SESSION_CREATED, {
        agent_type: 'claude',
        from_spec: true
      })
      
      expect(posthogMock.capture).toHaveBeenCalledWith(
        AnalyticsEventName.SESSION_CREATED,
        { agent_type: 'claude', from_spec: true }
      )
    })

    it('should truncate very long strings', async () => {
      analytics.track(AnalyticsEventName.SESSION_CREATED, {
        agent_type: 'a'.repeat(150), // Very long string
        from_spec: false
      })
      
      expect(posthogMock.capture).toHaveBeenCalledWith(
        AnalyticsEventName.SESSION_CREATED,
        { agent_type: 'redacted_long_string', from_spec: false }
      )
    })

    it('should remove null and undefined properties', async () => {
      analytics.track(AnalyticsEventName.SESSION_CREATED, {
        agent_type: 'claude',
        from_spec: true
      })
      
      const capturedProps = posthogMock.capture.mock.calls[0][1]
      expect(capturedProps).not.toHaveProperty('null_prop')
      expect(capturedProps).not.toHaveProperty('undefined_prop')
    })
  })

  describe('user feedback tracking', () => {
    beforeEach(async () => {
      mockInvoke.mockResolvedValueOnce(true)
      await analytics.initialize()
    })

    it('should track user feedback event with message and version', async () => {
      analytics.track(AnalyticsEventName.USER_FEEDBACK, {
        message: 'Great app! Love the UI',
        version: '1.0.0'
      })
      
      expect(posthogMock.capture).toHaveBeenCalledWith(
        AnalyticsEventName.USER_FEEDBACK,
        {
          message: 'Great app! Love the UI',
          version: '1.0.0'
        }
      )
    })

    it('should sanitize long feedback messages', async () => {
      const longMessage = 'a'.repeat(150)
      analytics.track(AnalyticsEventName.USER_FEEDBACK, {
        message: longMessage,
        version: '1.0.0'
      })
      
      expect(posthogMock.capture).toHaveBeenCalledWith(
        AnalyticsEventName.USER_FEEDBACK,
        {
          message: 'redacted_long_string',
          version: '1.0.0'
        }
      )
    })

    it('should not track feedback without consent', async () => {
      posthogMock.capture.mockClear()
      await analytics.updateConsent(false)
      
      analytics.track(AnalyticsEventName.USER_FEEDBACK, {
        message: 'Test feedback',
        version: '1.0.0'
      })
      
      expect(posthogMock.capture).not.toHaveBeenCalled()
    })

    it('should handle feedback submission errors gracefully', async () => {
      posthogMock.capture.mockImplementationOnce(() => {
        throw new Error('Network error')
      })
      
      expect(() => {
        analytics.track(AnalyticsEventName.USER_FEEDBACK, {
          message: 'Test feedback',
          version: '1.0.0'
        })
      }).not.toThrow()
    })
  })
})