import { defineConfig } from "vite";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

// https://vite.dev/config/
export default defineConfig(({ command }) => ({

  // Vite options tailored for Tauri development and only applied in `tauri dev` or `tauri build`
  //
  // 1. prevent Vite from obscuring rust errors
  clearScreen: false,
  // Ensure built asset paths work when loaded from filesystem in the Tauri bundle
  base: command === 'build' ? './' : '/',
  // 2. tauri expects a fixed port, fail if that port is not available
  server: {
    port: parseInt(process.env.VITE_PORT || '1420'),
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      // 3. tell Vite to ignore watching `src-tauri` and worktrees
      ignored: ["**/src-tauri/**", "**/.schaltwerk/worktrees/**"],
    },
  },
  build: {
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.warn'],
        passes: 2,
      },
      mangle: {
        safari10: true,
      },
    },
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          if (id.includes('react') || id.includes('react-dom')) {
            return 'react-vendor';
          }
          if (id.includes('xterm')) {
            return 'xterm-vendor';
          }
          if (id.includes('highlight.js')) {
            return 'highlight-vendor';
          }
          if (id.includes('clsx') || id.includes('react-icons') || id.includes('react-split')) {
            return 'ui-vendor';
          }
          if (id.includes('@tauri-apps')) {
            return 'tauri-vendor';
          }
          if (id.includes('node_modules')) {
            return 'vendor';
          }
        },
      },
    },
    chunkSizeWarningLimit: 600,
    sourcemap: false,
    reportCompressedSize: false,
    target: 'es2020',
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'xterm', '@tauri-apps/api', 'clsx', 'highlight.js'],
    esbuildOptions: {
      target: 'es2020',
    },
  },
  esbuild: {
    target: 'es2020',
    legalComments: 'none',
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  },
}));
