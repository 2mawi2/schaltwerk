import posthog from 'posthog-js';
import { invoke } from '@tauri-apps/api/core';
import { logger } from '../utils/logger';
import { AnalyticsEventName, AnalyticsEvents } from './events';

type EventName = AnalyticsEventName;

class Analytics {
  private initialized = false;
  private consentGiven = false;
  private environment: 'production' | 'development' = 'development';
  private buildSource: 'homebrew' | 'local' | 'unknown' = 'unknown';
  private skipInitEvents = true;
  
  async initialize() {
    try {
      this.consentGiven = await invoke<boolean>('get_analytics_consent');
      
      if (!this.consentGiven) {
        logger.debug('Analytics consent not given, skipping PostHog initialization');
        return;
      }
      
      const apiKey = import.meta.env.VITE_POSTHOG_KEY;
      
      if (!apiKey) {
        logger.warn('PostHog API key not configured, analytics disabled');
        return;
      }
      
      // Detect environment and build source
      this.detectEnvironment();
      
      posthog.init(apiKey, {
        api_host: 'https://eu.posthog.com',
        
        // Disable ALL automatic tracking
        autocapture: false,
        capture_pageview: false,
        capture_pageleave: false,
        disable_session_recording: true,
        capture_performance: false, // Disable web vitals
        
        // No user profiles - anonymous only
        person_profiles: 'never',
        
        // Set initial properties to track environment
        bootstrap: {
          distinctID: this.getDistinctId(),
          featureFlags: {},
        },
        
        // Use localStorage for persistence
        persistence: 'localStorage',
        
        // Start with capturing disabled
        opt_out_capturing_by_default: true,
        
        // Don't track any default properties or auto events
        sanitize_properties: (properties) => {
          // Remove any URL/path information and web vitals
          delete properties.$current_url;
          delete properties.$pathname;
          delete properties.$host;
          delete properties.$viewport_height;
          delete properties.$viewport_width;
          
          // Remove any property that looks like web vitals
          Object.keys(properties).forEach(key => {
            if (key.startsWith('$') || key.includes('web_vital') || key.includes('performance')) {
              delete properties[key];
            }
          });
          
          return properties;
        },
        
        loaded: (_ph) => {
          // Enable capturing
          posthog.opt_in_capturing();
          
          // Set super properties that will be included with every event
          posthog.register({
            environment: this.environment,
            build_source: this.buildSource,
          });
          
          // Override capture to skip initial events
          const originalCapture = posthog.capture.bind(posthog);
          const validEvents = Object.values(AnalyticsEventName) as string[];
          posthog.capture = (event: string, properties?: any, options?: any) => {
            // Always skip opt-in, opt-out, and web vitals events
            if (event === '$opt_in' || event === '$opt_out' || event === '$web_vitals') {
              logger.debug(`Skipping automatic event: ${event}`);
              return undefined;
            }
            
            // Allow our analytics events always
            if (validEvents.includes(event)) {
              return originalCapture(event, properties, options);
            }
            
            // Block any other events during init period
            if (this.skipInitEvents) {
              logger.debug(`Skipping non-analytics event during init: ${event}`);
              return undefined;
            }
            
            // After init period, allow other events (though we shouldn't have any)
            return originalCapture(event, properties, options);
          };
          
          // Stop skipping after a short delay
          setTimeout(() => {
            this.skipInitEvents = false;
          }, 100);
          
          logger.info(`PostHog analytics initialized - Environment: ${this.environment}, Build: ${this.buildSource}`);
        }
      });
      
      this.initialized = true;
    } catch (error) {
      logger.error('Failed to initialize analytics', error);
    }
  }
  
  private hasValidConsent(): boolean {
    return this.initialized && this.consentGiven;
  }
  
  isConsentGiven(): boolean {
    return this.consentGiven;
  }
  
  isInitialized(): boolean {
    return this.initialized;
  }
  
  track<T extends EventName>(event: T, properties: AnalyticsEvents[T]) {
    if (!this.hasValidConsent()) {
      logger.debug(`Analytics tracking blocked - no valid consent: ${event}`);
      return;
    }
    
    try {
      const sanitized = this.sanitizeProperties(properties);
      
      posthog.capture(event, sanitized);
      logger.debug(`Analytics event tracked: ${event}`, sanitized);
    } catch (error) {
      logger.error(`Failed to track analytics event: ${event}`, error);
    }
  }
  
  async updateConsent(consent: boolean) {
    this.consentGiven = consent;
    
    if (!consent && this.initialized) {
      posthog.opt_out_capturing();
      this.initialized = false;
      logger.info('Analytics disabled by user');
    } else if (consent && !this.initialized) {
      await this.initialize();
    }
  }
  
  private sanitizeProperties(props: any): Record<string, any> {
    if (!props) return {};
    
    const sanitized: Record<string, any> = {};
    
    for (const [key, value] of Object.entries(props)) {
      if (value === null || value === undefined) {
        continue;
      }
      
      if (typeof value === 'string' && value.includes('/')) {
        continue;
      }
      
      if (typeof value === 'string' && value.length > 100) {
        sanitized[key] = 'redacted_long_string';
        continue;
      }
      
      sanitized[key] = value;
    }
    
    return sanitized;
  }
  
  private detectEnvironment() {
    // Check if running in development mode
    const isDev = import.meta.env.DEV || import.meta.env.MODE === 'development';
    
    // Check if API key matches production pattern
    const apiKey = import.meta.env.VITE_POSTHOG_KEY;
    const isProdKey = apiKey && apiKey.startsWith('phc_');
    
    // Determine environment
    this.environment = isDev ? 'development' : 'production';
    
    // Determine build source
    if (isDev) {
      this.buildSource = 'local';
    } else if (isProdKey && !isDev) {
      // Production build with real API key likely means Homebrew
      this.buildSource = 'homebrew';
    } else {
      this.buildSource = 'unknown';
    }
  }
  
  private getDistinctId(): string {
    // For local development, use a consistent ID based on username or machine
    if (this.buildSource === 'local') {
      // This will create a consistent ID for local development
      return `local_dev_${this.hashString(import.meta.env.USER || 'unknown_user')}`;
    }
    
    // For production, let PostHog generate a random ID
    return posthog.get_distinct_id() || `anon_${Date.now()}`;
  }
  
  private hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash).toString(36);
  }
  
  getEnvironment(): 'production' | 'development' {
    return this.environment;
  }
  
  getBuildSource(): 'homebrew' | 'local' | 'unknown' {
    return this.buildSource;
  }
  
  shutdown() {
    if (this.initialized) {
      // PostHog doesn't have a shutdown method, just reset initialization
      this.initialized = false;
      logger.debug('Analytics shutdown');
    }
  }
}

export const analytics = new Analytics();