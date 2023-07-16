/*
  This script is heavily inspired by `built.ts` used in @kaze-style/react.
  https://github.com/taishinaritomi/kaze-style/blob/main/scripts/build.ts
  MIT License
  Copyright (c) 2022 Taishi Naritomi
*/

import { exec } from 'child_process'
import fs from 'fs'
import path from 'path'
import { build } from 'esbuild'
import type { Plugin, PluginBuild, BuildOptions } from 'esbuild'
import glob from 'glob'

const entryPoints = glob.sync('./src/**/*.ts', {
  ignore: ['./src/types.ts'],
})

/*
  This plugin is inspired by the following.
  https://github.com/evanw/esbuild/issues/622#issuecomment-769462611
*/
const addExtension = (extension: string = '.js', fileExtension: string = '.ts'): Plugin => ({
  name: 'add-extension',
  setup(build: PluginBuild) {
    build.onResolve({ filter: /.*/ }, (args) => {
      if (args.importer) {
        const p = path.join(args.resolveDir, args.path)
        let tsPath = `${p}${fileExtension}`

        let importPath = ''
        if (fs.existsSync(tsPath)) {
          importPath = args.path + extension
        } else {
          tsPath = path.join(args.resolveDir, args.path, `index${fileExtension}`)
          if (fs.existsSync(tsPath)) {
            importPath = `${args.path}/index${extension}`
          }
        }
        return { path: importPath, external: true }
      }
    })
  },
})

const commonOptions: BuildOptions = {
  entryPoints,
  logLevel: 'info',
  platform: 'node',
}

const cjsBuild = () =>
  build({
    ...commonOptions,
    outbase: './src',
    outdir: './dist',
    format: 'cjs',
  })

const esmBuild = () =>
  build({
    ...commonOptions,
    bundle: true,
    outbase: './src',
    outdir: './dist',
    format: 'esm',
    outExtension: { '.js': '.mjs' },
    plugins: [addExtension('.mjs')],
  })

Promise.all([esmBuild(), cjsBuild()])

exec(`tsc --emitDeclarationOnly --declaration`)
