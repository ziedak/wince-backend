 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/postgre_client',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
