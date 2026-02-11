import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['./src/**/*.ts'],
  format: ['esm', 'cjs'],
  dts: true,
  sourcemap: false,
  clean: true,
  target: false,
})
