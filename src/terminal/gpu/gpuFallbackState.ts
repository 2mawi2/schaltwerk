export type GpuAccelerationPreference = 'auto' | 'on' | 'off';

type SuggestedRendererType = 'dom' | undefined;

let suggestedRendererType: SuggestedRendererType = undefined;

export function getSuggestedRendererType(): SuggestedRendererType {
  return suggestedRendererType;
}

export function shouldAttemptWebgl(preference: GpuAccelerationPreference): boolean {
  if (preference === 'on') {
    return true;
  }

  if (preference === 'off') {
    return false;
  }

  return suggestedRendererType === undefined;
}

export function markWebglFailedGlobally(_reason?: string): void {
  suggestedRendererType = 'dom';
}

export function resetSuggestedRendererType(): void {
  suggestedRendererType = undefined;
}
