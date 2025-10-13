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
        maxThreads: 4
      }
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
      // Include all source files even if not imported by tests
      all: true,
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.*',
        'src/test/**',
        'src/**/__mocks__/**'
      ],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tauri-apps/plugin-os': path.resolve(__dirname, './src/test/mocks/tauri-plugin-os.ts'),
    },
  },
})
