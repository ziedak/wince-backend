import { defineConfig, mergeConfig } from 'vite'
import dts from 'vite-plugin-dts'

export function createLibraryViteConfig(options, overrides = {}) {
  return mergeConfig(
    defineConfig({
      root: options.root,

      cacheDir: options.cacheDir,

      plugins: [
        dts({
          entryRoot: 'src',
          tsconfigPath: options.tsconfigPath,
        }),
      ],

      build: {
        outDir: options.outDir ?? './dist',
        emptyOutDir: true,
        reportCompressedSize: true,

        commonjsOptions: {
          transformMixedEsModules: true,
        },

        lib: {
          entry: options.entry,
          name: options.name,
          fileName: 'index',
          formats: ['es'],
        },

        rollupOptions: {
          external: options.external ?? [],
        },
      },
    }),
    overrides
  )
}