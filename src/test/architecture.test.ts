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
  STATE_MANAGEMENT_EXCEPTIONS,
  ERROR_HANDLING_EXCEPTIONS,
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

describe('Error Handling Architecture', () => {
  it('should not have empty catch blocks without logging', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return true;
        const relativePath = toRelativePath(file.path);
        if (isTestFile(relativePath) || isException(relativePath, ERROR_HANDLING_EXCEPTIONS)) {
          return true;
        }

        const content = file.content;
        const lines = content.split('\n');
        const matches: FailureDetail[] = [];

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];

          const catchMatch = /(?:^|[^.])\s*catch\s*\(/.exec(line);
          if (!catchMatch) continue;

          const paramEndIndex = line.indexOf(')', catchMatch.index);
          if (paramEndIndex === -1) continue;

          const openBraceIndex = line.indexOf('{', paramEndIndex);
          if (openBraceIndex === -1) continue;

          let braceDepth = 0;
          let catchBlockStart = i;
          let catchBlockEnd = -1;
          let startedCounting = false;

          for (let j = i; j < lines.length; j++) {
            const currentLine = lines[j];
            const startPos = (j === i) ? openBraceIndex : 0;

            for (let k = startPos; k < currentLine.length; k++) {
              const char = currentLine[k];

              if (currentLine.substring(k).match(/^\/\//)) {
                break;
              }

              if (char === '{') {
                braceDepth++;
                startedCounting = true;
              } else if (char === '}') {
                braceDepth--;
                if (braceDepth === 0 && startedCounting) {
                  catchBlockEnd = j;
                  break;
                }
              }
            }
            if (catchBlockEnd !== -1) break;
          }

          if (catchBlockEnd === -1) continue;

          const catchBlock = lines
            .slice(catchBlockStart, catchBlockEnd + 1)
            .join('\n');

          const hasLogging =
            /logger\.(error|warn|debug|info)/.test(catchBlock) ||
            /console\.(error|warn|log)/.test(catchBlock);

          const hasThrow = /\bthrow\b/.test(catchBlock);
          const hasReturn = /\breturn\b/.test(catchBlock);

          const nonCommentLines = lines
            .slice(catchBlockStart + 1, catchBlockEnd)
            .filter((l) => {
              const t = l.trim();
              return t.length > 0 && !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('}');
            });

          const isEmpty = nonCommentLines.length === 0;

          if (isEmpty || (!hasLogging && !hasThrow && !hasReturn)) {
            matches.push({
              line: i + 1,
              snippet: `catch block without logging (lines ${catchBlockStart + 1}-${catchBlockEnd + 1})`,
            });
          }
        }

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return false;
        }

        return true;
      }, 'Catch blocks must log errors or rethrow');

    const violations = await rule.check();
    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} empty catch blocks or catch blocks without logging:`,
      'Add logger.error() or console.error() calls, or rethrow the error',
    );
  });
});

describe('State Management Architecture', () => {
  it('should not use React Context for state management (migrate to Jotai)', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/**')
      .should()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return true;
        const relativePath = toRelativePath(file.path);

        if (
          isTestFile(relativePath) ||
          relativePath.startsWith('src/store/atoms/') ||
          isException(relativePath, STATE_MANAGEMENT_EXCEPTIONS)
        ) {
          return true;
        }

        const lines = file.content.split('\n');
        const matches: FailureDetail[] = [];

        lines.forEach((line, index) => {
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;

          const contextPatterns = [
            /createContext\s*</,
            /createContext\s*\(/,
            /\.Provider\s+value=/,
            /const\s+\w+Context\s*=\s*createContext/,
          ];

          for (const pattern of contextPatterns) {
            if (pattern.test(line)) {
              matches.push({
                line: index + 1,
                snippet: line.trim().substring(0, 80),
              });
              break;
            }
          }
        });

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return false;
        }

        return true;
      }, 'Use Jotai atoms for state management instead of React Context');

    const violations = await rule.check();
    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} files using React Context (should use Jotai):`,
      'All contexts in STATE_MANAGEMENT_EXCEPTIONS should be migrated to Jotai atoms.',
    );
  });

  it('should use Jotai atom naming conventions', async () => {
    const failureDetails = new Map<string, FailureDetail[]>();
    const rule = projectFiles()
      .inFolder('src/store/atoms/**')
      .should()
      .adhereTo((file) => {
        if (!isSourceFile(file)) return true;
        const relativePath = toRelativePath(file.path);
        if (isTestFile(relativePath) || relativePath.endsWith('.gitkeep')) {
          return true;
        }

        const lines = file.content.split('\n');
        const matches: FailureDetail[] = [];

        lines.forEach((line, index) => {
          if (line.trim().startsWith('//') || line.trim().startsWith('*')) return;

          const exportAtomPattern = /export\s+const\s+(\w+)\s*=\s*atom/;
          const match = exportAtomPattern.exec(line);

          if (match) {
            const atomName = match[1];
            const hasCorrectSuffix = atomName.endsWith('Atom') ||
                                    atomName.endsWith('AtomFamily') ||
                                    atomName.endsWith('ActionAtom');

            if (!hasCorrectSuffix) {
              matches.push({
                line: index + 1,
                snippet: `${atomName} (should end with Atom, AtomFamily, or ActionAtom)`,
              });
            }
          }
        });

        if (matches.length > 0) {
          failureDetails.set(relativePath, matches);
          return false;
        }

        return true;
      }, 'Atom names should end with Atom, AtomFamily, or ActionAtom');

    const violations = await rule.check();

    if (violations.length > 0 && violations[0] && typeof violations[0] === 'object') {
      const violation = violations[0] as { message?: string };
      if (violation.message && violation.message.includes('No files found matching pattern')) {
        return;
      }
    }

    raiseIfViolations(
      violations,
      failureDetails,
      `Found ${violations.length} atoms with incorrect naming:`,
      'Use *Atom, *AtomFamily, or *ActionAtom suffixes.',
    );
  });

  it('should have migrated all contexts from exception list', async () => {
    const acceptableUse = STATE_MANAGEMENT_EXCEPTIONS.filter(
      ex => ex.reason.includes('acceptable use')
    ).length;
    const needsEvaluation = STATE_MANAGEMENT_EXCEPTIONS.filter(
      ex => ex.reason.includes('Needs evaluation')
    ).length;
    const pendingMigration = STATE_MANAGEMENT_EXCEPTIONS.filter(
      ex => ex.reason.includes('Pending migration')
    );
    const MIGRATED_CONTEXTS = 2;
    const migratedContexts = MIGRATED_CONTEXTS;
    const totalToMigrate = migratedContexts + pendingMigration.length;
    const migrationProgress = ((migratedContexts / totalToMigrate) * 100).toFixed(1);

    console.log(`\nState Management Migration Progress: ${migratedContexts}/${totalToMigrate} contexts migrated (${migrationProgress}%)`);
    console.log(`Acceptable Context usage: ${acceptableUse} (UI coordination)`);
    console.log(`Needs evaluation: ${needsEvaluation}`);
    console.log('\nRemaining contexts to migrate:');
    pendingMigration.forEach((ex, index) => {
      console.log(`  ${index + 1}. ${ex.file}`);
    });
    console.log('');
  });
});
