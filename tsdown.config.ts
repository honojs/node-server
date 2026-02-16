import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/**/*.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  target: false,
  outExtensions({ format }) {
    return {
      js: format === 'cjs' ? '.js' : '.mjs',
      dts: format === 'cjs' ? '.d.ts' : '.d.mts',
    }
  },
})
