import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { analytics } from '../analytics';
import { logger } from '../utils/logger';

interface AnalyticsConfig {
  consent_given: boolean;
  consent_asked: boolean;
}

export interface UseAnalyticsConsentReturn {
  showBanner: boolean;
  isLoading: boolean;
  handleConsent: (consent: boolean) => Promise<void>;
}

export function useAnalyticsConsent(): UseAnalyticsConsentReturn {
  const [showBanner, setShowBanner] = useState(false);
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    checkConsentStatus();
  }, []);

  const checkConsentStatus = async () => {
    try {
      const status = await invoke<AnalyticsConfig>('get_analytics_consent_status');
      if (!status.consent_asked) {
        setShowBanner(true);
      }
    } catch (error) {
      logger.error('Failed to check consent status', error);
    }
  };

  const handleConsent = useCallback(async (consent: boolean) => {
    if (isLoading) return;
    
    setIsLoading(true);
    try {
      await invoke('set_analytics_consent', { consent });
      await analytics.updateConsent(consent);
      setShowBanner(false);
      logger.info(`Analytics consent ${consent ? 'granted' : 'denied'}`);
    } catch (error) {
      logger.error('Failed to set consent', error);
      throw error;
    } finally {
      setIsLoading(false);
    }
  }, [isLoading]);

  return {
    showBanner,
    isLoading,
    handleConsent
  };
}