 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/utils',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
