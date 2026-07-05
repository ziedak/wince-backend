import { defineConfig, mergeConfig } from 'vitest/config'

export function createLibraryVitestConfig(options, overrides = {}) {
  return mergeConfig(
    defineConfig({
      test: {
        name: options.name,

        globals: true,
        watch: false,
        environment: options.environment ?? 'node',

        include: [
          '{src,tests}/**/*.{test,spec}.{js,mjs,cjs,ts,mts,cts,jsx,tsx}',
        ],

        reporters: ['default'],

        coverage: {
          provider: 'v8',
          reportsDirectory:
            options.coverageDir ?? './test-output/vitest/coverage',
        },
      },
    }),
    overrides
  )
}