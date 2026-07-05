 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/db',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
