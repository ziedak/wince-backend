 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/clickhouse_client',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
