import { fork, spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { once } from 'node:events'
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const mode = process.argv[2] || 'micro'
if (!['micro', 'pipeline', 'http'].includes(mode)) throw new Error('Use micro, pipeline or http')
const rounds = Number(process.env.BENCH_ROUNDS || 5)
const seconds = Number(process.env.BENCH_SECONDS || 4)
if (!Number.isInteger(rounds) || rounds < 1 || !Number.isFinite(seconds) || seconds <= 0)
  throw new Error('BENCH_ROUNDS and BENCH_SECONDS must be positive')
const variants =
  process.env.BENCH_SKIP_COPY === '1' ? ['baseline', 'guarded'] : ['baseline', 'copy', 'guarded']
const output = resolve(
  process.env.BENCH_RESULTS ||
    fileURLToPath(new URL(`./.work/${mode}-${process.version}.jsonl`, import.meta.url))
)
if (existsSync(output))
  throw new Error(`Refusing to overwrite ${output}; choose a new BENCH_RESULTS path`)
const metadata = JSON.parse(readFileSync(new URL('./.work/metadata.json', import.meta.url), 'utf8'))
const honoVersion = JSON.parse(
  readFileSync(new URL('../../node_modules/hono/package.json', import.meta.url), 'utf8')
).version
if (metadata.hono !== honoVersion) throw new Error('Hono version changed; run prepare.mjs again')
for (const variant of variants) {
  if (!metadata.bundles?.[variant])
    throw new Error('Run prepare.mjs with the same BENCH_SKIP_COPY setting')
  const bundle = readFileSync(new URL(`./.work/dist/${variant}/index.mjs`, import.meta.url))
  if (createHash('sha256').update(bundle).digest('hex') !== metadata.bundles[variant])
    throw new Error(`Prepared ${variant} bundle changed; run prepare.mjs again`)
}
const save = (row) => {
  const value = {
    ...row,
    mode,
    base: metadata.base,
    candidate: metadata.candidate,
    bundleSha256: metadata.bundles[row.variant],
    hono: metadata.hono,
  }
  appendFileSync(output, JSON.stringify(value) + '\n')
  console.log(JSON.stringify(value))
}
const load = (url, duration) =>
  new Promise((resolve, reject) => {
    const child = spawn(
      process.env.BENCH_BOMBARDIER || 'bombardier',
      ['-c', '64', '-d', `${duration}s`, '-p', 'r', '-o', 'json', url],
      { env: { ...process.env, GOMAXPROCS: '2' } }
    )
    let out = '',
      err = ''
    child.stdout.on('data', (x) => (out += x))
    child.stderr.on('data', (x) => (err += x))
    child.on('error', reject)
    child.on('exit', (code) => (code === 0 ? resolve(JSON.parse(out)) : reject(new Error(err))))
  })
const send = async (child, message) => {
  const event = once(child, 'message', { signal: AbortSignal.timeout(10000) })
  child.send(message)
  return (await event)[0]
}
for (let round = 0; round < rounds; round++) {
  for (const kind of mode === 'http' ? ['json', 'json8', 'text'] : ['all']) {
    for (let j = 0; j < variants.length; j++) {
      const variant = variants[(j + round) % variants.length]
      if (mode !== 'http') {
        const result = spawnSync(
          process.execPath,
          ['--expose-gc', fileURLToPath(new URL(`./${mode}.mjs`, import.meta.url)), variant],
          { encoding: 'utf8' }
        )
        if (result.status !== 0) throw new Error(result.stderr)
        for (const line of result.stdout.trim().split('\n')) save({ round, ...JSON.parse(line) })
        continue
      }
      const child = fork(new URL('./server.mjs', import.meta.url), [variant], {
        stdio: ['ignore', 'ignore', 'inherit', 'ipc'],
      })
      try {
        const { port, headerPaths, ...runtime } = (
          await once(child, 'message', { signal: AbortSignal.timeout(10000) })
        )[0]
        const url = `http://127.0.0.1:${port}/${kind}`
        const response = await fetch(url)
        const expected = kind === 'text' ? 'Hello, world!' : '{"message":"Hello, world!"}'
        if (response.status !== 200 || (await response.text()) !== expected)
          throw new Error('Response mismatch')
        await load(url, 1)
        await send(child, 'start')
        const benchmark = await load(url, seconds)
        const stats = await send(child, 'end')
        const result = benchmark.result
        if (
          result.req1xx ||
          result.req3xx ||
          result.req4xx ||
          result.req5xx ||
          result.others ||
          result.errors ||
          !result.req2xx
        )
          throw new Error(`Load test failed: ${JSON.stringify(result)}`)
        save({ round, variant, kind, headers: headerPaths[kind], ...runtime, ...stats, benchmark })
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = once(child, 'exit')
          child.kill('SIGTERM')
          await exited
        }
      }
    }
  }
}
