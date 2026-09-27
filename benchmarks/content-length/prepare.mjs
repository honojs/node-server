import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, mkdirSync, readFileSync, symlinkSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'tsdown'

const root = fileURLToPath(new URL('../../', import.meta.url))
const work = fileURLToPath(new URL('./.work/', import.meta.url))
const honoVersion = JSON.parse(
  readFileSync(resolve(root, 'node_modules/hono/package.json'), 'utf8')
).version
const base = process.argv[2]
if (!base) throw new Error('Usage: node benchmarks/content-length/prepare.mjs BASE_REF')
const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' })
const revision = git('rev-parse', `${base}^{commit}`).trim()
const variants =
  process.env.BENCH_SKIP_COPY === '1' ? ['baseline', 'guarded'] : ['baseline', 'copy', 'guarded']
mkdirSync(work, { recursive: true })
if (!existsSync(resolve(work, 'node_modules'))) {
  symlinkSync(resolve(root, 'node_modules'), resolve(work, 'node_modules'), 'junction')
}
const files = git('ls-tree', '-r', '--name-only', revision, 'src').trim().split('\n')
for (const variant of variants) {
  const dir = resolve(work, variant)
  mkdirSync(dir, { recursive: true })
  if (variant === 'guarded') {
    cpSync(resolve(root, 'src'), resolve(dir, 'src'), { recursive: true })
  } else {
    for (const file of files) {
      const target = resolve(dir, file)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, git('show', `${revision}:${file}`))
    }
  }
  const listenerPath = resolve(dir, 'src/listener.ts')
  let listener = readFileSync(listenerPath, 'utf8')
  if (variant === 'copy') {
    if (listener.includes('canAutoLength'))
      throw new Error('Baseline must precede the Content-Length experiment')
    const start = listener.indexOf('  let hasContentLength = false')
    const marker = '\n  // in `responseViaCache`'
    const end = listener.indexOf(marker, start)
    if (start === -1 || end === -1) throw new Error('Unsupported baseline listener')
    const section = listener.slice(start, end)
    const insertion = section.lastIndexOf('\n  }')
    listener =
      listener.slice(0, start) +
      section.slice(0, insertion) +
      `
    if (!hasContentLength && (typeof body === 'string' || body instanceof Uint8Array || body instanceof Blob)) {
      header = { ...header }
    }` +
      section.slice(insertion) +
      listener.slice(end)
  }
  if (!listener.includes('const responseViaCache =')) throw new Error('Missing cache handler')
  writeFileSync(
    listenerPath,
    listener.replace('const responseViaCache =', 'export const responseViaCache =')
  )
  const indexPath = resolve(dir, 'src/index.ts')
  writeFileSync(
    indexPath,
    readFileSync(indexPath, 'utf8') +
      `
export { responseViaCache } from './listener'
export { Response as LightweightResponse } from './response'
`
  )
  await build({
    config: false,
    entry: [indexPath],
    outDir: resolve(work, 'dist', variant),
    format: ['esm'],
    dts: false,
    target: false,
    external: ['hono'],
    clean: true,
  })
}
writeFileSync(
  resolve(work, 'metadata.json'),
  JSON.stringify(
    {
      base: revision,
      candidate: git('rev-parse', 'HEAD').trim(),
      candidateDiff: git('diff', 'HEAD', '--', 'src'),
      bundles: Object.fromEntries(
        variants.map((variant) => [
          variant,
          createHash('sha256')
            .update(readFileSync(resolve(work, 'dist', variant, 'index.mjs')))
            .digest('hex'),
        ])
      ),
      hono: honoVersion,
    },
    null,
    2
  )
)
