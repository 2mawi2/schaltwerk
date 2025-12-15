import { defineConfig } from 'vite'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'happy-dom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    pool: 'threads',
    poolOptions: {
      threads: {
        singleThread: false,
        minThreads: 1,
        maxThreads: 4,
      },
    },
    include: [
      'src/**/*.test.ts',
      'src/**/*.test.tsx'
    ],
    exclude: [
      'node_modules/**',
      'vscode/**',
      '.schaltwerk/**',
      'dist/**',
      '**/*.performance.test.*',
      '**/*.bench.test.*'
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
