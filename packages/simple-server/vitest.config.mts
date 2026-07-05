 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/simple-server',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
