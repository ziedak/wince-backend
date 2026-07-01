import { defineConfig } from 'drizzle-kit';

if (!process.env['DATABASE_URL']) {
  throw new Error('DATABASE_URL environment variable is required');
}

export default defineConfig({
  out: './src/migrations',
  // Glob avoids the barrel's .js ESM imports which drizzle-kit's CJS bundler cannot resolve.
  schema: './src/schema/*.ts',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env['DATABASE_URL'],
  },
});
