import type { UserConfig } from 'vite'

export interface LibraryOptions {
  root: string
  cacheDir: string
  entry: string
  name: string
  tsconfigPath: string
  outDir?: string
  external?: string[]
}

export interface VitestOptions {
  name: string
  environment?: 'node' | 'jsdom'
  coverageDir?: string
}

export declare function createLibraryViteConfig(
  options: LibraryOptions,
  overrides?: UserConfig & { test?: Record<string, unknown> }
): UserConfig

export declare function createLibraryVitestConfig(
  options: VitestOptions,
  overrides?: UserConfig & { test?: Record<string, unknown> }
): UserConfig