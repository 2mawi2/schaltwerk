import path from 'node:path';
import { fileURLToPath } from 'node:url';
import js from '@eslint/js';
import tseslint from '@typescript-eslint/eslint-plugin';
import tsparser from '@typescript-eslint/parser';
import reactHooks from 'eslint-plugin-react-hooks';
import noEmptyCatchHandlers from './eslint-rules/no-empty-catch-handlers.js';
import noTailwindFontSizes from './eslint-rules/no-tailwind-font-sizes.js';
import noHardcodedColors from './eslint-rules/no-hardcoded-colors.js';
import modalFocusProtection from './eslint-rules/modal-focus-protection.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const localPlugin = {
  rules: {
    'no-empty-catch-handlers': noEmptyCatchHandlers,
    'no-tailwind-font-sizes': noTailwindFontSizes,
    'no-hardcoded-colors': noHardcodedColors,
    'modal-focus-protection': modalFocusProtection,
  },
};

export default [
  js.configs.recommended,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        project: [path.resolve(__dirname, 'tsconfig.json')],
        tsconfigRootDir: __dirname,
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        navigator: 'readonly',
        alert: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        Node: 'readonly',
        Element: 'readonly',
        AbortController: 'readonly',
        NodeJS: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'react-hooks': reactHooks,
      'local': localPlugin,
    },
    rules: {
      // React hooks rules
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      
      // TypeScript specific rules - Strict unused code detection
      'no-unused-vars': 'off', // Turn off base rule as we use TypeScript's rule
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: false,
        },
      ],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: false,
          allowTernary: false,
          allowTaggedTemplates: false,
        },
      ],
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/no-misused-promises': 'error',
      '@typescript-eslint/no-explicit-any': 'warn',

      // General rules
      'no-console': 'warn',
      'no-debugger': 'error',
      'no-undef': 'off', // Turn off since we define globals above
      'no-empty': ['error', { allowEmptyCatch: false }], // Disallow empty catch blocks
      'local/no-empty-catch-handlers': 'error', // Disallow empty .catch() handlers
      'local/no-hardcoded-colors': 'warn', // Warn on hardcoded colors in styles (for theme support)
    },
  },
  {
    files: [
      'src/components/sidebar/SessionCard.tsx',
      'src/components/specs/**/*.{ts,tsx}',
      'src/components/terminal/UnifiedTab.tsx',
      'src/components/terminal/TerminalTabs.tsx',
    ],
    rules: {
      'local/no-tailwind-font-sizes': 'error',
    },
  },
  {
    files: [
      'src/components/modals/**/*.tsx',
      'src/components/shared/ResizableModal.tsx',
    ],
    rules: {
      'local/modal-focus-protection': 'error',
    },
  },
  {
    files: ['src/**/*.test.{ts,tsx}'],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        ecmaFeatures: {
          jsx: true,
        },
        project: [path.resolve(__dirname, 'tsconfig.json')],
        tsconfigRootDir: __dirname,
      },
      globals: {
        // Browser globals
        window: 'readonly',
        document: 'readonly',
        console: 'readonly',
        setTimeout: 'readonly',
        clearTimeout: 'readonly',
        setInterval: 'readonly',
        clearInterval: 'readonly',
        requestAnimationFrame: 'readonly',
        cancelAnimationFrame: 'readonly',
        navigator: 'readonly',
        alert: 'readonly',
        CustomEvent: 'readonly',
        Event: 'readonly',
        KeyboardEvent: 'readonly',
        MouseEvent: 'readonly',
        HTMLElement: 'readonly',
        HTMLDivElement: 'readonly',
        Node: 'readonly',
        Element: 'readonly',
        AbortController: 'readonly',
        NodeJS: 'readonly',
        // Test globals
        describe: 'readonly',
        it: 'readonly',
        expect: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
      },
    },
    plugins: {
      '@typescript-eslint': tseslint,
      'local': localPlugin,
    },
    rules: {
      // TypeScript specific rules - Strict unused code detection for tests
      '@typescript-eslint/no-unused-vars': [
        'error',
        {
          vars: 'all',
          args: 'after-used',
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          ignoreRestSiblings: false,
        },
      ],
      '@typescript-eslint/no-unused-expressions': [
        'error',
        {
          allowShortCircuit: false,
          allowTernary: false,
          allowTaggedTemplates: false,
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',

      // General rules
      'no-console': 'off', // Allow console in tests
      'no-debugger': 'error',
      'no-undef': 'off', // Turn off since we define globals above
      'no-empty': ['error', { allowEmptyCatch: false }], // Disallow empty catch blocks
      'local/no-empty-catch-handlers': 'error', // Disallow empty .catch() handlers
    },
  },
  {
    files: ['scripts/**/*.{js,cjs}'],
    languageOptions: {
      globals: {
        // Node.js globals
        console: 'readonly',
        process: 'readonly',
        __dirname: 'readonly',
        __filename: 'readonly',
        module: 'readonly',
        require: 'readonly',
        exports: 'readonly',
        global: 'readonly',
      },
    },
    rules: {
      'no-console': 'off', // Allow console in scripts
      'no-undef': 'off', // Turn off since we define globals above
    },
  },
];
