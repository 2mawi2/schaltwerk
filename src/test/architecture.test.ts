import { describe, it } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectFiles } from 'archunit';
import type { FileInfo } from 'archunit';
import {
  EVENT_LISTENER_EXCEPTIONS,
  MODULE_BOUNDARY_EXCEPTIONS,
  TAURI_COMMAND_EXCEPTIONS,
  THEME_EXCEPTIONS,
  isException,
} from './architecture-exceptions';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const projectRoot = path.resolve(__dirname, '..', '..');

type FailureDetail = {
  line: number;
  snippet: string;
};

const SOURCE_EXTENSIONS = new Set(['ts', 'tsx']);

function toRelativePath(filePath: string): string {
  return path
    .relative(projectRoot, filePath)
    .split(path.sep)
    .join('/');
}

function isSourceFile(file: FileInfo): boolean {
  return SOURCE_EXTENSIONS.has(file.extension);
}

function isTestFile(relativePath: string): boolean {
  return (
    relativePath.startsWith('src/test/') ||
    /\.test\.(ts|tsx)$/.test(relativePath)
  );
}

function formatFailureDetails(details: Map<string, FailureDetail[]>): string {
  return [...details.entries()]
    .flatMap(([file, matches]) =>
      matches.map((entry) => `${file}:${entry.line} - ${entry.snippet}`),
    )
    .join('\n');
}

function formatViolations(violations: unknown[]): string {
  return violations
    .map((violation) => {
      const fileInfo = (violation as { fileInfo?: FileInfo }).fileInfo;
      if (fileInfo) {
        const relative = toRelativePath(fileInfo.path);
        const message =
          typeof (violation as { message?: string }).message === 'string'
            ? (violation as { message: string }).message
            : 'Rule violation';
        return `${relative} - ${message}`;
      }
      if (typeof (violation as { message?: string }).message === 'string') {
        return (violation as { message: string }).message;
      }
      if (typeof (violation as { rule?: string }).rule === 'string') {
        return (violation as { rule: string }).rule;
      }
      return 'Unknown violation';
    })
    .join('\n');
}

function raiseIfViolations(
  violations: unknown[],
  details: Map<string, FailureDetail[]>,
  header: string,
  footer?: string,
) {
  if (violations.length === 0) return;
  const detailMessage =
    details.size > 0 ? formatFailureDetails(details) : formatViolations(violations);
  const messageParts = [header, detailMessage];
  if (footer) {
    messageParts.push('', footer);
  }
  throw new Error(messageParts.join('\n'));
}

describe('Tauri Command Architecture', () => {
  it('should use TauriCommands enum for all invoke calls', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return true;
        const relativePath = toRelativePath(file.path);
        if (
          relativePath === 'src/common/tauriCommands.ts' ||
          isTestFile(relativePath) ||
          isException(relativePath, TAURI_COMMAND_EXCEPTIONS)
        ) {
          return true;
        }

        const lines = file.content.split('\n');
        const matches: FailureDetail[] = [];
        lines.forEach((line, index) => {
          const pattern = /invoke\s*\(\s*['"`]([^'"`]+)['"`]/g;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(line)) !== null) {
            matches.push({
              line: index + 1,
              snippet: match[0].trim(),
            });
          }
        });

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return false;
        }

        return true;
      }, 'Use TauriCommands enum for invoke calls');

    const violations = await rule.check();
    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} string literal invoke() calls:`,
      'Use TauriCommands enum instead',
    );
  });
});

describe('Event System Architecture', () => {
  it('should use SchaltEvent enum for all event listeners', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return true;
        const relativePath = toRelativePath(file.path);
        if (
          relativePath === 'src/common/eventSystem.ts' ||
          isTestFile(relativePath) ||
          isException(relativePath, EVENT_LISTENER_EXCEPTIONS)
        ) {
          return true;
        }

        const lines = file.content.split('\n');
        const matches: FailureDetail[] = [];
        lines.forEach((line, index) => {
          if (line.includes('listenEvent') || line.includes('SchaltEvent')) {
            return;
          }
          const pattern = /(?:listen|once|emit)\s*\(\s*['"`]([^'"`]+)['"`]/g;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(line)) !== null) {
            matches.push({
              line: index + 1,
              snippet: match[0].trim(),
            });
          }
        });

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return false;
        }

        return true;
      }, 'Use SchaltEvent enum helpers for event wiring');

    const violations = await rule.check();
    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} string literal event calls:`,
      'Use SchaltEvent enum + helpers instead',
    );
  });
});

describe('Theme System Architecture', () => {
  it('should not use hardcoded colors outside theme files', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return true;
        const relativePath = toRelativePath(file.path);
        if (
          relativePath === 'src/common/theme.ts' ||
          relativePath.startsWith('src/styles/') ||
          isTestFile(relativePath) ||
          isException(relativePath, THEME_EXCEPTIONS)
        ) {
          return true;
        }

        const lines = file.content.split('\n');
        const matches: FailureDetail[] = [];
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          const pattern =
            /#[0-9a-fA-F]{3,8}\b|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\)/g;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(line)) !== null) {
            matches.push({
              line: index + 1,
              snippet: match[0].trim(),
            });
          }
        });

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return false;
        }

        return true;
      }, 'Use theme.colors.* for palette access');

    const violations = await rule.check();
    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} hardcoded colors:`,
      'Use theme.colors.* instead',
    );
  });

  it('should not use hardcoded font sizes outside theme files', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return true;
        const relativePath = toRelativePath(file.path);
        if (
          relativePath === 'src/common/theme.ts' ||
          relativePath.startsWith('src/styles/') ||
          isTestFile(relativePath) ||
          isException(relativePath, THEME_EXCEPTIONS)
        ) {
          return true;
        }

        const lines = file.content.split('\n');
        const matches: FailureDetail[] = [];
        lines.forEach((line, index) => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
          const pattern =
            /(?:fontSize|font-size)\s*[=:]\s*['"`]?(\d+(?:\.\d+)?(?:px|rem|em))['"`]?/g;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(line)) !== null) {
            matches.push({
              line: index + 1,
              snippet: match[0].trim(),
            });
          }
        });

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return false;
        }

        return true;
      }, 'Use theme.fontSize.* for typography');

    const violations = await rule.check();
    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} hardcoded font sizes:`,
      'Use theme.fontSize.* instead',
    );
  });
});

describe('Module Boundaries Architecture', () => {
  it('common/ should not import from components/ or contexts/', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/common/**')
      .shouldNot()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return false;
        const relativePath = toRelativePath(file.path);
        if (isTestFile(relativePath) || isException(relativePath, MODULE_BOUNDARY_EXCEPTIONS)) {
          return false;
        }

        const lines = file.content.split('\n');
        const matches: FailureDetail[] = [];
        lines.forEach((line, index) => {
          const pattern =
            /import\s+.*\s+from\s+['"](\.\.[/\\](?:components|contexts)[^'"]*)['"]/g;
          let match: RegExpExecArray | null;
          while ((match = pattern.exec(line)) !== null) {
            matches.push({
              line: index + 1,
              snippet: `imports ${match[1]}`,
            });
          }
        });

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return true;
        }

        return false;
      }, 'common/ must stay independent of components/contexts');

    const violations = await rule.check();
    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} common/ imports from components/contexts:`,
    );
  });
});
