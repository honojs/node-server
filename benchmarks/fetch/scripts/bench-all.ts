/**
 * Runs both benchmark suites and prints a combined report.
 *
 * Suite A — Realistic (bombardier):
 *   500 connections · no pipelining · 10s per endpoint
 *   Three endpoints: GET / (ping), GET /id/:id (query), POST /json (body)
 *
 * Suite B — Fastify-methodology (autocannon):
 *   100 connections · pipelining 10 · 10s warmup + 40s measurement
 *   Single endpoint: GET / → JSON { hello: 'world' }
 */

import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const PORT = 3000

// ─── shared helpers ──────────────────────────────────────────────────────────

async function waitForServer(): Promise<void> {
  for (let i = 0; i < 30; i++) {
    try {
      const res = await fetch(`http://127.0.0.1:${PORT}/`)
      if (res.ok) {
        process.stdout.write(' ready\n')
        return
      }
    } catch {
      await setTimeout(200)
    }
  }
  throw new Error('Server failed to start')
}

function startServer(file: string): ReturnType<typeof spawn> {
  return spawn('node', [file], { stdio: ['ignore', 'inherit', 'inherit'] })
}

async function killServer(server: ReturnType<typeof spawn>, pause = 1000): Promise<void> {
  server.kill()
  await setTimeout(pause)
}

// ─── Suite A: bombardier ─────────────────────────────────────────────────────

interface BombardierResult {
  name: string
  ping: number
  query: number
  body: number
  avg: number
}

async function bombardierRun(url: string, extraArgs: string[] = []): Promise<number> {
  return new Promise((resolve, reject) => {
    let stdout = ''
    const args = ['--fasthttp', '-c', '500', '-d', '10s', ...extraArgs, url]
    const proc = spawn('bombardier', args, { stdio: ['ignore', 'pipe', 'ignore'] })
    proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`bombardier exited ${code}`))
      const m = stdout.match(/Reqs\/sec\s+([\d.]+)/)
      resolve(m ? parseFloat(m[1]) : 0)
    })
  })
}

async function runBombardierServer(file: string, name: string): Promise<BombardierResult> {
  process.stdout.write(`  ${name}...`)
  const server = startServer(file)
  try {
    await waitForServer()
    const ping = await bombardierRun(`http://127.0.0.1:${PORT}/`)
    const query = await bombardierRun(`http://127.0.0.1:${PORT}/id/1?name=bun`)
    const body = await bombardierRun(`http://127.0.0.1:${PORT}/json`, [
      '-m', 'POST', '-H', 'Content-Type:application/json', '-f', './scripts/body.json',
    ])
    const avg = (ping + query + body) / 3
    return { name, ping, query, body, avg }
  } finally {
    await killServer(server)
  }
}

// ─── Suite B: autocannon ─────────────────────────────────────────────────────

interface AutocannonResult {
  name: string
  reqPerSec: number
  latencyAvg: number
  latencyP99: number
}

async function runAutocannonServer(file: string, name: string): Promise<AutocannonResult> {
  process.stdout.write(`  ${name}...`)
  const server = startServer(file)
  try {
    await waitForServer()

    const run = (duration: number, silent: boolean) =>
      new Promise<{ requests: { average: number }; latency: { average: number; p99: number } }>(
        (resolve, reject) => {
          const args = [
            'autocannon', '--json',
            '-c', '100', '-p', '10', '-d', String(duration),
            `http://127.0.0.1:${PORT}/`,
          ]
          let stdout = ''
          const proc = spawn('npx', args, {
            stdio: ['ignore', 'pipe', silent ? 'ignore' : 'inherit'],
          })
          proc.stdout.on('data', (d: Buffer) => { stdout += d.toString() })
          proc.on('close', (code) => {
            if (code !== 0) return reject(new Error(`autocannon exited ${code}`))
            try { resolve(JSON.parse(stdout)) } catch (e) { reject(e) }
          })
        }
      )

    process.stdout.write(' warming up...')
    await run(10, true)
    process.stdout.write(' measuring...')
    const result = await run(40, true)
    process.stdout.write(' done\n')

    return {
      name,
      reqPerSec: result.requests.average,
      latencyAvg: result.latency.average,
      latencyP99: result.latency.p99,
    }
  } finally {
    await killServer(server, 500)
  }
}

// ─── main ─────────────────────────────────────────────────────────────────────

async function main() {
  const bombardierServers = [
    { file: 'src/server-npm.js',     name: '@hono/node-server (npm)' },
    { file: 'src/server-dev-v2.js',  name: '@hono/node-server (v2)' },
    { file: 'src/server-hono.js',    name: 'hono (v2)' },
    { file: 'src/server-fastify.js', name: 'fastify' },
  ]

  const autocannonServers = [
    { file: 'src/hello-node.js',    name: 'node:http (baseline)' },
    { file: 'src/hello-npm.js',     name: '@hono/node-server (npm)' },
    { file: 'src/hello-v2.js',      name: '@hono/node-server (v2)' },
    { file: 'src/hello-hono.js',    name: 'hono (v2)' },
    { file: 'src/hello-fastify.js', name: 'fastify' },
  ]

  // ── Suite A ────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════')
  console.log('SUITE A  —  Realistic (bombardier · 500 connections · no pipelining)')
  console.log('════════════════════════════════════════════════════════════════\n')

  const bombResults: BombardierResult[] = []
  for (const s of bombardierServers) {
    try {
      bombResults.push(await runBombardierServer(s.file, s.name))
    } catch (e) {
      console.error(`  ✗ ${s.name}:`, (e as Error).message)
    }
  }

  bombResults.sort((a, b) => b.avg - a.avg)
  const fmt = (n: number) => n.toLocaleString('en-US', { maximumFractionDigits: 0 })

  console.log()
  console.log(`| ${'Server'.padEnd(28)} | ${'Average'.padStart(9)} | ${'Ping'.padStart(9)} | ${'Query'.padStart(9)} | ${'Body'.padStart(9)} |`)
  console.log(`| ${'-'.repeat(28)} | ${'-'.repeat(9)} | ${'-'.repeat(9)} | ${'-'.repeat(9)} | ${'-'.repeat(9)} |`)
  for (const r of bombResults) {
    console.log(
      `| ${r.name.padEnd(28)} | ${fmt(r.avg).padStart(9)} | ${fmt(r.ping).padStart(9)} | ${fmt(r.query).padStart(9)} | ${fmt(r.body).padStart(9)} |`
    )
  }

  // ── Suite B ────────────────────────────────────────────────────────────────
  console.log('\n════════════════════════════════════════════════════════════════')
  console.log('SUITE B  —  Fastify-methodology (autocannon · 100 conn · pipelining 10 · 40s)')
  console.log('════════════════════════════════════════════════════════════════\n')

  const acResults: AutocannonResult[] = []
  for (const s of autocannonServers) {
    try {
      acResults.push(await runAutocannonServer(s.file, s.name))
    } catch (e) {
      console.error(`  ✗ ${s.name}:`, (e as Error).message)
    }
  }

  acResults.sort((a, b) => b.reqPerSec - a.reqPerSec)
  const baseline = acResults.find((r) => r.name.startsWith('node:http'))

  console.log()
  console.log(`| ${'Server'.padEnd(28)} | ${'Req/s'.padStart(9)} | ${'% baseline'.padStart(10)} | ${'Lat avg'.padStart(8)} | ${'Lat p99'.padStart(8)} |`)
  console.log(`| ${'-'.repeat(28)} | ${'-'.repeat(9)} | ${'-'.repeat(10)} | ${'-'.repeat(8)} | ${'-'.repeat(8)} |`)
  for (const r of acResults) {
    const pct = baseline ? `${((r.reqPerSec / baseline.reqPerSec) * 100).toFixed(0)}%` : '-'
    console.log(
      `| ${r.name.padEnd(28)} | ${fmt(r.reqPerSec).padStart(9)} | ${pct.padStart(10)} | ${r.latencyAvg.toFixed(2).padStart(8)} | ${r.latencyP99.toFixed(0).padStart(8)} |`
    )
  }

  console.log()
}

main().catch((e) => { console.error(e); process.exit(1) })
