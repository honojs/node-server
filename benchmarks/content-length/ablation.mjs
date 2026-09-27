// Diagnostic variants only: run prepare.mjs before this script.
import { spawnSync } from 'node:child_process'
import { appendFileSync, mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createHash } from 'node:crypto'
const work = new URL('./.work/', import.meta.url)
const baseline = readFileSync(new URL('dist/baseline/index.mjs', work), 'utf8')
const guarded = readFileSync(new URL('dist/guarded/index.mjs', work), 'utf8')
const original = `\tif (!hasContentLength) {
\t\tif (typeof body === "string") header["Content-Length"] = Buffer.byteLength(body);
\t\telse if (body instanceof Uint8Array) header["Content-Length"] = body.byteLength;
\t\telse if (body instanceof Blob) header["Content-Length"] = body.size;
\t}`
if (baseline.split(original).length !== 2)
  throw new Error('Unexpected baseline; regenerate and inspect it')
const local = `\tif (!hasContentLength) {
\t\tif (typeof body === "string") { let length = Buffer.byteLength(body); header["Content-Length"] = length; }
\t\telse if (body instanceof Uint8Array) { let length = body.byteLength; header["Content-Length"] = length; }
\t\telse if (body instanceof Blob) { let length = body.size; header["Content-Length"] = length; }
\t}`
const merged = `\tif (!hasContentLength) {
\t\tlet length;
\t\tif (typeof body === "string") length = Buffer.byteLength(body);
\t\telse if (body instanceof Uint8Array) length = body.byteLength;
\t\telse if (body instanceof Blob) length = body.size;
\t\tif (length !== undefined) header["Content-Length"] = length;
\t}`
const variants = {
  baseline,
  'baseline-repeat': baseline,
  'let-local': baseline.replace(original, local),
  'let-merged': baseline.replace(original, merged),
  guarded,
}
for (const [name, code] of Object.entries(variants)) {
  mkdirSync(new URL(`dist/${name}/`, work), { recursive: true })
  writeFileSync(new URL(`dist/${name}/index.mjs`, work), code)
}
const naturalGC = process.env.ABLATION_GC === 'natural'
let worker = readFileSync(new URL('./pipeline.mjs', import.meta.url), 'utf8')
  .replace('`./.work/dist/${variant}/index.mjs`', '`./dist/${variant}/index.mjs`')
  .replace("'./header-path.mjs'", "'../header-path.mjs'")
  .replace('Object.entries(cases)', "process.argv[3].split(',').map(kind => [kind, cases[kind]])")
worker = worker
  .replace("const forceGC = process.env.BENCH_GC === 'forced'", `const forceGC = ${!naturalGC}`)
  .replace(
    'const warmupIterations = Number(process.env.BENCH_WARMUP || 300000)',
    `const warmupIterations = ${naturalGC ? 300000 : 100000}`
  )
writeFileSync(new URL('ablation-worker.mjs', work), worker)
writeFileSync(
  new URL('ablation-manifest.json', work),
  JSON.stringify(
    Object.fromEntries(
      Object.entries(variants).map(([name, code]) => [
        name,
        { sha256: createHash('sha256').update(code).digest('hex'), length: code.length },
      ])
    ),
    null,
    2
  )
)
if (process.argv[2] === '--prepare-only') process.exit(0)
const node = process.env.ABLATION_NODE || process.execPath
const rounds = Number(process.env.ABLATION_ROUNDS || 5)
const output = new URL(
  `ablation-${node.split('/').slice(-3, -1).join('-') || 'node'}${naturalGC ? '-natural-gc' : ''}.jsonl`,
  work
)
if (existsSync(output)) throw new Error(`Output exists: ${output}`)
const names = Object.keys(variants)
for (let round = 0; round < rounds; round++) {
  for (const order of naturalGC
    ? ['json,json8']
    : round % 2
      ? ['json,json8', 'json8']
      : ['json8', 'json,json8']) {
    for (let j = 0; j < names.length; j++) {
      const variant = names[(j + round) % names.length]
      const result = spawnSync(
        node,
        ['--expose-gc', fileURLToPath(new URL('ablation-worker.mjs', work)), variant, order],
        { encoding: 'utf8' }
      )
      if (result.status !== 0) throw new Error(result.stderr)
      for (const line of result.stdout.trim().split('\n')) {
        const row = { round, order, gc: naturalGC ? 'natural' : 'forced', ...JSON.parse(line) }
        appendFileSync(output, JSON.stringify(row) + '\n')
        console.log(JSON.stringify(row))
      }
    }
  }
}
