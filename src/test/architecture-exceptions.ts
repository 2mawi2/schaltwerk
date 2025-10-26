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

export function isException(
  file: string,
  exceptionList: ArchitectureException[],
): boolean {
  return exceptionList.some((ex) => file.includes(ex.file));
}
