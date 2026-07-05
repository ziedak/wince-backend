import path from 'node:path';
import { createLibraryViteConfig } from '../../vite/index.js'


const root = import.meta.dirname;

export default createLibraryViteConfig({
  root,
  cacheDir: '../../node_modules/.vite/packages/types',
  entry: 'src/index.ts',
  name: '@org/types',
  tsconfigPath: path.join(root, 'tsconfig.lib.json'),
  outDir: './dist',
  external: [],
})