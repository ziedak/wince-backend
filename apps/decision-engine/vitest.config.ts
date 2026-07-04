import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    name: 'decision-engine',
    globals: true,
    environment: 'node',
    include: ['src/**/*.{spec,test}.ts'],
  },
});
