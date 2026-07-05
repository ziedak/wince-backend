 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/nonitoring',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
