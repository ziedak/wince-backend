 import { createLibraryVitestConfig } from '../../vite/index.js'

export default createLibraryVitestConfig({
  name: '@org/onnx-runtime',
  environment: 'node',
  coverageDir: './test-output/vitest/coverage',
})
