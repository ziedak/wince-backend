import path from 'node:path';
import { createLibraryViteConfig } from '../../vite/index.js'


const root = import.meta.dirname;

export default createLibraryViteConfig({
  root,
  cacheDir: '../../node_modules/.vite/packages/clickhouse_client',
  entry: 'src/index.ts',
  name: '@org/clickhouse_client',
  tsconfigPath: path.join(root, 'tsconfig.lib.json'),
  outDir: './dist',
  external: [],
})