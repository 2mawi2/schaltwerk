import { beforeEach, describe, expect, it } from 'vitest';

import {
  getSuggestedRendererType,
  markWebglFailedGlobally,
  resetSuggestedRendererType,
  shouldAttemptWebgl,
} from './gpuFallbackState';

describe('gpuFallbackState', () => {
  beforeEach(() => {
    resetSuggestedRendererType();
  });

  it('allows WebGL when GPU mode is auto and no failure has occurred', () => {
    expect(shouldAttemptWebgl('auto')).toBe(true);
    expect(getSuggestedRendererType()).toBeUndefined();
  });

  it('disables WebGL attempts for auto mode after a failure', () => {
    markWebglFailedGlobally('initialization-error');

    expect(shouldAttemptWebgl('auto')).toBe(false);
    expect(getSuggestedRendererType()).toBe('dom');
  });

  it('continues attempting WebGL when GPU mode is forced on', () => {
    markWebglFailedGlobally('context-loss');

    expect(shouldAttemptWebgl('on')).toBe(true);
  });

  it('never attempts WebGL when GPU mode is off', () => {
    expect(shouldAttemptWebgl('off')).toBe(false);
  });

  it('resets fallback state when requested', () => {
    markWebglFailedGlobally('test');

    resetSuggestedRendererType();

    expect(getSuggestedRendererType()).toBeUndefined();
    expect(shouldAttemptWebgl('auto')).toBe(true);
  });
});
