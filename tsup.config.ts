import { defineConfig } from 'tsup'
import type { Options } from 'tsup'

const options: Options = {
  format: ['esm', 'cjs'],
  dts: true,
  splitting: false,
  sourcemap: false,
  clean: true,
}
export default defineConfig([
  {
    entry: ['./src/**/*.ts', '!./src/serve.ts'],
    ...options,
  },
  {
    entry: ['./src/serve.ts'],
    ...options,
    banner: { js: '#!/usr/bin/env node' },
  },
])
