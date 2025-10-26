import { describe, it, expect } from 'vitest';
import * as fs from 'node:fs';
import path from 'node:path';
import { glob } from 'glob';
import { fileURLToPath } from 'node:url';
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

function readFileLines(file: string): string[] {
  const content = fs.readFileSync(file, 'utf-8');
  return content.split('\n');
}

describe('Tauri Command Architecture', () => {
  it('should use TauriCommands enum for all invoke calls', () => {
    const files = glob.sync('src/**/*.{ts,tsx}', {
      cwd: projectRoot,
      absolute: true,
      ignore: [
        'src/common/tauriCommands.ts',
        'src/test/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
    });

    const invokePattern = /invoke\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of files) {
      if (isException(file, TAURI_COMMAND_EXCEPTIONS)) continue;
      const lines = readFileLines(file);
      lines.forEach((line, idx) => {
        let match: RegExpExecArray | null;
        while ((match = invokePattern.exec(line)) !== null) {
          violations.push({
            file: path.relative(projectRoot, file),
            line: idx + 1,
            match: match[0],
          });
        }
      });
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `${v.file}:${v.line} - ${v.match}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} string literal invoke() calls:\n${message}\n\nUse TauriCommands enum instead`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

describe('Event System Architecture', () => {
  it('should use SchaltEvent enum for all event listeners', () => {
    const files = glob.sync('src/**/*.{ts,tsx}', {
      cwd: projectRoot,
      absolute: true,
      ignore: [
        'src/common/eventSystem.ts',
        'src/test/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
    });

    const eventPattern = /(?:listen|once|emit)\s*\(\s*['"`]([^'"`]+)['"`]/g;
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of files) {
      if (isException(file, EVENT_LISTENER_EXCEPTIONS)) continue;
      const lines = readFileLines(file);
      lines.forEach((line, idx) => {
        if (line.includes('listenEvent') || line.includes('SchaltEvent')) {
          return;
        }
        let match: RegExpExecArray | null;
        while ((match = eventPattern.exec(line)) !== null) {
          violations.push({
            file: path.relative(projectRoot, file),
            line: idx + 1,
            match: match[0],
          });
        }
      });
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `${v.file}:${v.line} - ${v.match}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} string literal event calls:\n${message}\n\nUse SchaltEvent enum + helpers instead`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

describe('Theme System Architecture', () => {
  it('should not use hardcoded colors outside theme files', () => {
    const files = glob.sync('src/**/*.{ts,tsx}', {
      cwd: projectRoot,
      absolute: true,
      ignore: [
        'src/common/theme.ts',
        'src/styles/**',
        'src/test/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
    });

    const colorPattern =
      /#[0-9a-fA-F]{3,8}\b|rgba?\s*\([^)]+\)|hsla?\s*\([^)]+\)/g;
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of files) {
      if (isException(file, THEME_EXCEPTIONS)) continue;
      const lines = readFileLines(file);
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        let match: RegExpExecArray | null;
        while ((match = colorPattern.exec(line)) !== null) {
          violations.push({
            file: path.relative(projectRoot, file),
            line: idx + 1,
            match: match[0],
          });
        }
      });
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `${v.file}:${v.line} - ${v.match}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} hardcoded colors:\n${message}\n\nUse theme.colors.* instead`,
      );
    }

    expect(violations).toHaveLength(0);
  });

  it('should not use hardcoded font sizes outside theme files', () => {
    const files = glob.sync('src/**/*.{ts,tsx}', {
      cwd: projectRoot,
      absolute: true,
      ignore: [
        'src/common/theme.ts',
        'src/styles/**',
        'src/test/**',
        'src/**/*.test.ts',
        'src/**/*.test.tsx',
      ],
    });

    const fontSizePattern =
      /(?:fontSize|font-size)\s*[=:]\s*['"`]?(\d+(?:\.\d+)?(?:px|rem|em))['"`]?/g;
    const violations: Array<{ file: string; line: number; match: string }> = [];

    for (const file of files) {
      if (isException(file, THEME_EXCEPTIONS)) continue;
      const lines = readFileLines(file);
      lines.forEach((line, idx) => {
        const trimmed = line.trim();
        if (trimmed.startsWith('//') || trimmed.startsWith('*')) return;
        let match: RegExpExecArray | null;
        while ((match = fontSizePattern.exec(line)) !== null) {
          violations.push({
            file: path.relative(projectRoot, file),
            line: idx + 1,
            match: match[0],
          });
        }
      });
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `${v.file}:${v.line} - ${v.match}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} hardcoded font sizes:\n${message}\n\nUse theme.fontSize.* instead`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});

describe('Module Boundaries Architecture', () => {
  it('common/ should not import from components/ or contexts/', () => {
    const files = glob.sync('src/common/**/*.{ts,tsx}', {
      cwd: projectRoot,
      absolute: true,
      ignore: ['src/common/**/*.test.ts', 'src/common/**/*.test.tsx'],
    });

    const importPattern =
      /import\s+.*\s+from\s+['"](\.\.[/\\](?:components|contexts)[^'"]*)['"]/g;
    const violations: Array<{ file: string; line: number; import: string }> = [];

    for (const file of files) {
      if (isException(file, MODULE_BOUNDARY_EXCEPTIONS)) continue;
      const lines = readFileLines(file);
      lines.forEach((line, idx) => {
        let match: RegExpExecArray | null;
        while ((match = importPattern.exec(line)) !== null) {
          violations.push({
            file: path.relative(projectRoot, file),
            line: idx + 1,
            import: match[1],
          });
        }
      });
    }

    if (violations.length > 0) {
      const message = violations
        .map((v) => `${v.file}:${v.line} - imports ${v.import}`)
        .join('\n');
      throw new Error(
        `Found ${violations.length} common/ imports from components/contexts:\n${message}`,
      );
    }

    expect(violations).toHaveLength(0);
  });
});
