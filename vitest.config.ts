import { defineConfig } from 'vite'
import path from 'path'

const domTestFiles = [
  'src/**/*.test.tsx',
  'src/common/terminalSizeCache.test.ts',
  'src/components/diff/sidebarScroll.test.ts',
  'src/components/inputs/dropdownGeometry.test.ts',
  'src/components/terminal/TerminalResizeCoordinator.test.ts',
  'src/components/terminal/terminalKeybindings.test.ts',
  'src/dev/registerDevErrorListeners.test.ts',
  'src/hooks/__tests__/useTerminalGpu.test.ts',
  'src/hooks/useAgentTabs.test.ts',
  'src/hooks/useBranchSearch.test.ts',
  'src/hooks/useClaudeSession.test.ts',
  'src/hooks/useDiffHover.test.ts',
  'src/hooks/useLineSelection.test.ts',
  'src/hooks/useOnboarding.test.ts',
  'src/hooks/usePermissions.test.ts',
  'src/hooks/useProjectFileIndex.test.ts',
  'src/hooks/useReviewComments.test.ts',
  'src/hooks/useSelectionPreserver.test.ts',
  'src/hooks/useSessionManagement.test.ts',
  'src/hooks/useSessionPrefill.test.ts',
  'src/hooks/useSettings.test.ts',
  'src/hooks/useSetupScriptApproval.test.ts',
  'src/hooks/useSpecMode.test.ts',
  'src/hooks/useStreamingDecoder.test.ts',
  'src/hooks/useTerminalTabs.test.ts',
  'src/hooks/useUpdateSessionFromParent.test.ts',
  'src/keyboardShortcuts/matcher.test.ts',
  'src/store/atoms/fontSize.test.ts',
  'src/store/atoms/language.test.ts',
  'src/store/atoms/layout.test.ts',
  'src/store/atoms/project.test.ts',
  'src/store/atoms/selection.test.ts',
  'src/store/atoms/terminal.test.ts',
  'src/store/atoms/theme.test.ts',
  'src/utils/__tests__/splitDragCoordinator.test.ts',
  'src/utils/normalizeCliText.test.ts',
  'src/terminal/gpu/webglCapability.test.ts',
  'src/terminal/gpu/webglRenderer.test.ts',
  'src/terminal/registry/terminalRegistry.test.ts',
  'src/terminal/xterm/XtermTerminal.test.ts',
]

const nodeTestFiles = [
  'src/**/*.test.ts',
  'scripts/cua/**/*.test.js',
]

const excludedFiles = [
  'node_modules/**',
  'vscode/**',
  '.schaltwerk/**',
  'dist/**',
  '**/*.performance.test.*',
  '**/*.bench.test.*',
]

export default defineConfig({
  test: {
    globals: true,
    server: {
      deps: {
        inline: ['@pierre/diffs', 'lru_map'],
      },
    },
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 4,
      },
    },
    projects: [
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          setupFiles: ['./src/test/setup-node.ts'],
          include: nodeTestFiles,
          exclude: [...excludedFiles, ...domTestFiles],
        },
      },
      {
        extends: true,
        test: {
          name: 'dom',
          environment: 'happy-dom',
          setupFiles: ['./src/test/setup.ts'],
          include: domTestFiles,
          exclude: excludedFiles,
        },
      },
    ],
    coverage: {
      reporter: ['text', 'json', 'json-summary', 'html'],
      reportsDirectory: './coverage',
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.*',
        'src/test/**',
        'src/**/__mocks__/**'
      ],
    },
    onConsoleLog(log) {
      if (log.includes('--localstorage-file')) return false
      if (log.includes('baseline-browser-mapping')) return false
      if (log.includes('trace-warnings')) return false
      return true
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tauri-apps/plugin-os': path.resolve(__dirname, './src/test/mocks/tauri-plugin-os.ts'),
      '@tauri-apps/plugin-notification': path.resolve(__dirname, './src/test/mocks/tauri-plugin-notification.ts'),
    },
  },
})
