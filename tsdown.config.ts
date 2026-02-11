import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/**/*.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
  target: false,
})
