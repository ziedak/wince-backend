 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/types',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
