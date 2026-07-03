/// <reference types='vitest' />
import { defineConfig } from 'vite';
import path from 'node:path';

export default defineConfig({
  root: import.meta.dirname,
  cacheDir: '../../node_modules/.vite/apps/admin-api',
  resolve: {
    // Use the @org/source condition so workspace packages resolve to their TypeScript source
    conditions: ['@org/source', 'import', 'module', 'browser', 'default'],
    // Tell Rolldown to also search the app-local node_modules (where Bun places workspace symlinks)
    modules: [
      path.resolve(import.meta.dirname, 'node_modules'),
      'node_modules',
    ],
  },
  build: {
    // SSR mode: build a Node.js-compatible bundle from src/index.ts
    ssr: 'src/index.ts',
    target: 'node20',
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      external: [/^node:/],
      output: {
        format: 'es',
      },
    },
  },
  ssr: {
    noExternal: [/@org\/.*/],
  },
  test: {
    name: 'admin-api',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.{ts,tsx}'],
    coverage: {
      reportsDirectory: '../../coverage/apps/admin-api',
      provider: 'v8',
    },
  },
});
