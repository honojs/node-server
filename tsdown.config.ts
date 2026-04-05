import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/index.ts', './src/serve-static.ts', './src/conninfo.ts', './src/utils/*.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  target: false,
  outExtensions({ format }) {
    return { js: format === 'cjs' ? '.js' : '.mjs', dts: format === 'cjs' ? '.d.ts' : '.d.mts' }
  },
})
