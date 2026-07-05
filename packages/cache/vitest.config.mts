 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/cache',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
