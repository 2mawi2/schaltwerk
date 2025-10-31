export interface ArchitectureException {
  file: string;
  reason: string;
}

export const TAURI_COMMAND_EXCEPTIONS: ArchitectureException[] = [
  // { file: 'src/components/SomeComponent.tsx', reason: 'Legacy code, migration planned' },
];

export const EVENT_LISTENER_EXCEPTIONS: ArchitectureException[] = [
  // { file: 'src/hooks/useSomeHook.ts', reason: 'Third-party event listener' },
];

export const THEME_EXCEPTIONS: ArchitectureException[] = [
];

export const MODULE_BOUNDARY_EXCEPTIONS: ArchitectureException[] = [
  // { file: 'src/common/helpers.ts', reason: 'Transitional code' },
];

export const STATE_MANAGEMENT_EXCEPTIONS: ArchitectureException[] = [
  { file: 'src/common/toast/ToastProvider.tsx', reason: 'UI-specific context for toast notifications (acceptable use)' },
  { file: 'src/tests/test-utils.tsx', reason: 'Test utility providing mock contexts (acceptable use)' },
  { file: 'src/contexts/ModalContext.tsx', reason: 'UI coordination - modal open/close tracking (acceptable use)' },
  { file: 'src/contexts/FocusContext.tsx', reason: 'UI coordination - focus management (acceptable use)' },
  { file: 'src/contexts/ReviewContext.tsx', reason: 'UI coordination - review workflow state (acceptable use)' },
  { file: 'src/contexts/RunContext.tsx', reason: 'UI coordination - run workflow state (acceptable use)' },
  { file: 'src/contexts/GithubIntegrationContext.tsx', reason: 'Needs evaluation - might be dependency injection' },
  { file: 'src/contexts/KeyboardShortcutsContext.tsx', reason: 'Needs evaluation - might not need reactive state' },
  { file: 'src/contexts/SelectionContext.tsx', reason: 'Pending migration to Jotai' },
  { file: 'src/contexts/SessionsContext.tsx', reason: 'Pending migration to Jotai' },
];

export function isException(
  file: string,
  exceptionList: ArchitectureException[],
): boolean {
  return exceptionList.some((ex) => file.includes(ex.file));
}
