/**
 * Autocannon benchmark — matches the Fastify benchmark suite methodology:
 * https://github.com/fastify/benchmarks
 *
 * Settings: 100 connections, pipelining 10, 10s warmup + 40s measurement
 * Endpoint:  GET / → JSON { hello: 'world' }
 */

import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const PORT = 3000
const AUTOCANNON_CONNECTIONS = 100
const AUTOCANNON_PIPELINING = 10
const WARMUP_DURATION = 10
const BENCH_DURATION = 40

interface AutocannonResult {
  requests: { average: number; stddev: number; p99: number }
  latency: { average: number; stddev: number; p99: number }
  throughput: { average: number }
}

interface ServerResult {
  name: string
  reqPerSec: number
  latencyAvg: number
  latencyP99: number
  throughput: number
}

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`)
      if (res.ok) {
        console.log('✓ Server ready\n')
        return
      }
    } catch {
      await setTimeout(200)
    }
  }
  throw new Error('Server failed to start within 6s')
}

function runAutocannon(duration: number, silent: boolean): Promise<AutocannonResult> {
  return new Promise((resolve, reject) => {
    const args = [
      'autocannon',
      '--json',
      '-c', String(AUTOCANNON_CONNECTIONS),
      '-p', String(AUTOCANNON_PIPELINING),
      '-d', String(duration),
      `http://127.0.0.1:${PORT}/`,
    ]

    let stdout = ''
    const proc = spawn('npx', args, { stdio: ['ignore', 'pipe', silent ? 'ignore' : 'inherit'] })

    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`autocannon exited with code ${code}`))
      try {
        resolve(JSON.parse(stdout) as AutocannonResult)
      } catch (e) {
        reject(new Error(`Failed to parse autocannon output: ${e}`))
      }
    })
  })
}

async function benchmarkServer(file: string, name: string): Promise<ServerResult> {
  console.log(`${'='.repeat(60)}`)
  console.log(`Starting: ${name}`)
  console.log('='.repeat(60))

  const server = spawn('node', [file], { stdio: ['ignore', 'inherit', 'inherit'] })

  try {
    await waitForServer()

    // Warmup pass — discarded (matches Fastify benchmark methodology)
    process.stdout.write(`Warming up (${WARMUP_DURATION}s)...`)
    await runAutocannon(WARMUP_DURATION, true)
    console.log(' done\n')

    // Measurement pass
    console.log(`Measuring (${BENCH_DURATION}s, ${AUTOCANNON_CONNECTIONS} connections, pipelining ${AUTOCANNON_PIPELINING})...`)
    const result = await runAutocannon(BENCH_DURATION, false)

    return {
      name,
      reqPerSec: result.requests.average,
      latencyAvg: result.latency.average,
      latencyP99: result.latency.p99,
      throughput: result.throughput.average,
    }
  } finally {
    server.kill()
    await setTimeout(500)
  }
}

async function main(): Promise<void> {
  const servers = [
    { file: 'src/hello-node.js',    name: 'node:http (baseline)' },
    { file: 'src/hello-fastify.js', name: 'fastify' },
    { file: 'src/hello-npm.js',     name: '@hono/node-server (npm)' },
    { file: 'src/hello-v2.js',      name: '@hono/node-server (v2)' },
    { file: 'src/hello-hono.js',    name: 'hono (v2)' },
  ]

  const results: ServerResult[] = []

  for (const server of servers) {
    try {
      results.push(await benchmarkServer(server.file, server.name))
    } catch (err) {
      console.error(`Failed: ${server.name}:`, (err as Error).message)
    }
    // Give the OS a moment to reclaim ports/sockets between servers
    await setTimeout(1000)
  }

  // Sort by req/sec descending
  results.sort((a, b) => b.reqPerSec - a.reqPerSec)

  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })
  const fmtMs = (n: number) => n.toFixed(2)
  const fmtMb = (n: number) => (n / 1024 / 1024).toFixed(1)

  console.log('\n' + '='.repeat(78))
  console.log('AUTOCANNON RESULTS  (100 connections · pipelining 10 · 40s · GET / → JSON)')
  console.log('='.repeat(78))
  console.log(
    `| ${'Server'.padEnd(30)} | ${'Req/s'.padStart(10)} | ${'Lat avg'.padStart(8)} | ${'Lat p99'.padStart(8)} | ${'MB/s'.padStart(6)} |`
  )
  console.log(`| ${'-'.repeat(30)} | ${'-'.repeat(10)} | ${'-'.repeat(8)} | ${'-'.repeat(8)} | ${'-'.repeat(6)} |`)

  const baseline = results.find((r) => r.name.startsWith('node:http'))
  for (const r of results) {
    const pct = baseline && r.name !== baseline.name
      ? ` (${((r.reqPerSec / baseline.reqPerSec) * 100).toFixed(0)}%)`
      : ''
    console.log(
      `| ${(r.name + pct).padEnd(30)} | ${fmt(r.reqPerSec).padStart(10)} | ${fmtMs(r.latencyAvg).padStart(8)} | ${fmtMs(r.latencyP99).padStart(8)} | ${fmtMb(r.throughput).padStart(6)} |`
    )
  }
  console.log()
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
