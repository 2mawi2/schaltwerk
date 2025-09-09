import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { invoke } from '@tauri-apps/api/core';
import { useAnalyticsConsent } from './useAnalyticsConsent';
import { analytics } from '../analytics';
import { logger } from '../utils/logger';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn()
}));

vi.mock('../analytics', () => ({
  analytics: {
    updateConsent: vi.fn()
  }
}));

vi.mock('../utils/logger', () => ({
  logger: {
    error: vi.fn(),
    info: vi.fn()
  }
}));

describe('useAnalyticsConsent', () => {
  const mockInvoke = vi.mocked(invoke);
  const mockUpdateConsent = vi.mocked(analytics.updateConsent);
  const mockLoggerError = vi.mocked(logger.error);
  const mockLoggerInfo = vi.mocked(logger.info);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('initial state', () => {
    it('should not show banner when consent was already asked', async () => {
      mockInvoke.mockResolvedValueOnce({
        consent_given: true,
        consent_asked: true
      });

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(result.current.showBanner).toBe(false);
      });
      
      expect(result.current.isLoading).toBe(false);
    });

    it('should show banner when consent was not asked', async () => {
      mockInvoke.mockResolvedValueOnce({
        consent_given: false,
        consent_asked: false
      });

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(result.current.showBanner).toBe(true);
      });
      
      expect(result.current.isLoading).toBe(false);
    });

    it('should handle error when checking consent status', async () => {
      const error = new Error('Failed to get consent status');
      mockInvoke.mockRejectedValueOnce(error);

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(mockLoggerError).toHaveBeenCalledWith('Failed to check consent status', error);
      });
      
      expect(result.current.showBanner).toBe(false);
    });
  });

  describe('handleConsent', () => {
    it('should handle granting consent', async () => {
      mockInvoke.mockResolvedValueOnce({
        consent_given: false,
        consent_asked: false
      });

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(result.current.showBanner).toBe(true);
      });

      mockInvoke.mockResolvedValueOnce(undefined); // set_analytics_consent
      mockUpdateConsent.mockResolvedValueOnce(undefined);

      await act(async () => {
        await result.current.handleConsent(true);
      });

      expect(mockInvoke).toHaveBeenCalledWith('set_analytics_consent', { consent: true });
      expect(mockUpdateConsent).toHaveBeenCalledWith(true);
      expect(result.current.showBanner).toBe(false);
      expect(mockLoggerInfo).toHaveBeenCalledWith('Analytics consent granted');
    });

    it('should handle denying consent', async () => {
      mockInvoke.mockResolvedValueOnce({
        consent_given: false,
        consent_asked: false
      });

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(result.current.showBanner).toBe(true);
      });

      mockInvoke.mockResolvedValueOnce(undefined); // set_analytics_consent
      mockUpdateConsent.mockResolvedValueOnce(undefined);

      await act(async () => {
        await result.current.handleConsent(false);
      });

      expect(mockInvoke).toHaveBeenCalledWith('set_analytics_consent', { consent: false });
      expect(mockUpdateConsent).toHaveBeenCalledWith(false);
      expect(result.current.showBanner).toBe(false);
      expect(mockLoggerInfo).toHaveBeenCalledWith('Analytics consent denied');
    });

    it('should handle errors when setting consent', async () => {
      mockInvoke.mockResolvedValueOnce({
        consent_given: false,
        consent_asked: false
      });

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(result.current.showBanner).toBe(true);
      });

      const error = new Error('Failed to set consent');
      mockInvoke.mockRejectedValueOnce(error);

      await expect(act(async () => {
        await result.current.handleConsent(true);
      })).rejects.toThrow('Failed to set consent');

      expect(mockLoggerError).toHaveBeenCalledWith('Failed to set consent', error);
      expect(result.current.isLoading).toBe(false);
    });

    it('should prevent multiple simultaneous consent operations', async () => {
      mockInvoke.mockResolvedValueOnce({
        consent_given: false,
        consent_asked: false
      });

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(result.current.showBanner).toBe(true);
      });

      // Start first consent operation (don't await)
      mockInvoke.mockImplementation(() => new Promise(resolve => setTimeout(resolve, 100)));
      
      act(() => {
        result.current.handleConsent(true);
      });

      // Try to start second operation while first is loading
      await act(async () => {
        await result.current.handleConsent(false);
      });

      // Only one invoke should have been called
      expect(mockInvoke).toHaveBeenCalledTimes(2); // One for initial check, one for set_analytics_consent
    });

    it('should set loading state during consent operation', async () => {
      mockInvoke.mockResolvedValueOnce({
        consent_given: false,
        consent_asked: false
      });

      const { result } = renderHook(() => useAnalyticsConsent());

      await waitFor(() => {
        expect(result.current.showBanner).toBe(true);
      });

      // Mock invoke to be slow
      mockInvoke.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve(undefined), 100))
      );
      mockUpdateConsent.mockResolvedValueOnce(undefined);

      // Start consent operation without awaiting
      let consentPromise: Promise<void>;
      act(() => {
        consentPromise = result.current.handleConsent(true);
      });

      // Check loading state is true while operation is in progress
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      // Wait for operation to complete
      await act(async () => {
        await consentPromise!;
      });

      // Check loading state is false after completion
      expect(result.current.isLoading).toBe(false);
    });
  });
});