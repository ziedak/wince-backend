 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/logger',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
