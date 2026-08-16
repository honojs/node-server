import assert from 'node:assert/strict'
import { spawn, spawnSync, type ChildProcess } from 'node:child_process'
import { once } from 'node:events'
import { readFileSync, writeFileSync } from 'node:fs'
import { cpus } from 'node:os'
import { setTimeout } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'

const PORT = 3000
const CONNECTIONS = Number(process.env.BENCH_CONNECTIONS ?? 100)
const DURATION = process.env.BENCH_DURATION ?? '5s'
const WARMUP_DURATION = process.env.BENCH_WARMUP ?? '2s'
const TRIES = Number(process.env.BENCH_TRIES ?? 3)
const LARGE_SIZE = 64 * 1024

interface Server {
  file: string
  name: string
}

interface Scenario {
  name: string
  path: string
  method?: string
  headers?: string[]
  body?: string
  expectedStatus?: number
  verify: (response: Response) => Promise<void>
}

interface Sample {
  rps: number
  latencyMs: number
  throughputMb: number
}

interface ServerResult {
  server: Server
  peakRssMb: number | null
  scenarios: Map<string, Sample>
}

const jsonBody = JSON.stringify({ message: 'Hello!' })
const uploadBody = 'x'.repeat(LARGE_SIZE)

const scenarios: Scenario[] = [
  {
    name: 'empty response',
    path: '/empty',
    method: 'HEAD',
    expectedStatus: 204,
    verify: async (response) => assert.equal(await response.text(), ''),
  },
  {
    name: 'small text',
    path: '/',
    verify: async (response) => assert.equal(await response.text(), 'Hi'),
  },
  {
    name: 'URL + query',
    path: '/query?id=123&name=benchmark',
    verify: async (response) => assert.equal(await response.text(), '123 benchmark'),
  },
  {
    name: 'headers',
    path: '/headers',
    headers: ['x-test: 123'],
    verify: async (response) => {
      assert.equal(await response.text(), '123')
      assert.equal(response.headers.get('x-powered-by'), 'benchmark')
      assert.equal(response.headers.get('cache-control'), 'public, max-age=60')
    },
  },
  {
    name: 'JSON response',
    path: '/json',
    verify: async (response) =>
      assert.deepEqual(await response.json(), { message: 'Hello!', ok: true }),
  },
  {
    name: 'JSON round trip',
    path: '/json',
    method: 'POST',
    headers: ['content-type: application/json'],
    body: jsonBody,
    verify: async (response) => assert.deepEqual(await response.json(), { message: 'Hello!' }),
  },
  {
    name: '64 KiB upload',
    path: '/upload',
    method: 'POST',
    headers: ['content-type: application/octet-stream'],
    body: uploadBody,
    verify: async (response) => assert.equal(await response.text(), String(LARGE_SIZE)),
  },
  {
    name: '64 KiB fixed body',
    path: '/large',
    verify: async (response) => assert.equal((await response.arrayBuffer()).byteLength, LARGE_SIZE),
  },
  {
    name: '64 KiB stream',
    path: '/stream',
    verify: async (response) => assert.equal((await response.arrayBuffer()).byteLength, LARGE_SIZE),
  },
]

const servers: Server[] = [
  { file: 'src/server-node.js', name: 'node:http' },
  { file: 'src/server-npm.js', name: '@hono/node-server (npm)' },
  { file: 'src/server-srvx.js', name: 'srvx (fast)' },
  { file: 'src/server-dev.js', name: '@hono/node-server (dev)' },
]

function ohaVersion(): string {
  const result = spawnSync('oha', ['--version'], { encoding: 'utf8' })
  if (result.error || result.status !== 0) {
    throw new Error('oha is required: https://github.com/hatoo/oha')
  }
  return (result.stdout || result.stderr).trim() || 'unknown'
}

async function waitForServer(): Promise<void> {
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/`)
      if (response.ok) return
    } catch {}
    await setTimeout(100)
  }
  throw new Error('server did not become ready')
}

async function stopServer(child: ChildProcess): Promise<void> {
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = once(child, 'exit')
  child.kill('SIGKILL')
  await exited
}

function peakRssMb(pid: number | undefined): number | null {
  if (!pid) return null
  try {
    const match = readFileSync(`/proc/${pid}/status`, 'utf8').match(/VmHWM:\s+(\d+)\s+kB/)
    return match ? Number((Number(match[1]) / 1024).toFixed(1)) : null
  } catch {
    return null
  }
}

function ohaArgs(scenario: Scenario, duration: string): string[] {
  const args = [
    `http://127.0.0.1:${PORT}${scenario.path}`,
    '--no-tui',
    '--output-format',
    'json',
    '-c',
    String(CONNECTIONS),
    '-z',
    duration,
    '-m',
    scenario.method ?? 'GET',
  ]
  for (const header of scenario.headers ?? []) args.push('-H', header)
  if (scenario.body !== undefined) args.push('-d', scenario.body)
  return args
}

function runLoad(scenario: Scenario, duration: string): Sample {
  const result = spawnSync('oha', ohaArgs(scenario, duration), {
    encoding: 'utf8',
    maxBuffer: 10 * 1024 * 1024,
  })
  if (result.error || result.status !== 0) {
    throw new Error(result.stderr || result.error?.message || `oha exited ${result.status}`)
  }
  const output = JSON.parse(result.stdout)
  const expected = String(scenario.expectedStatus ?? 200)
  const statuses = Object.keys(output.statusCodeDistribution)
  // A duration-limited oha run cancels requests still in flight at its deadline.
  const errors = Object.keys(output.errorDistribution ?? {}).filter(
    (error) => error !== 'aborted due to deadline'
  )
  if (errors.length || statuses.length !== 1 || statuses[0] !== expected) {
    throw new Error(`load errors or unexpected responses: ${JSON.stringify({ errors, statuses })}`)
  }
  return {
    rps: output.rps.mean,
    latencyMs: output.summary.average * 1000,
    throughputMb: output.summary.totalData / output.summary.total / 1024 / 1024,
  }
}

async function verifyScenario(scenario: Scenario): Promise<void> {
  const headers = Object.fromEntries(
    (scenario.headers ?? []).map((header) => {
      const separator = header.indexOf(':')
      return [header.slice(0, separator), header.slice(separator + 1).trim()]
    })
  )
  const response = await fetch(`http://127.0.0.1:${PORT}${scenario.path}`, {
    method: scenario.method,
    headers,
    body: scenario.body,
  })
  assert.equal(response.status, scenario.expectedStatus ?? 200)
  await scenario.verify(response)
}

function median(samples: Sample[]): Sample {
  const middle = Math.floor(samples.length / 2)
  const value = (key: keyof Sample) => [...samples].sort((a, b) => a[key] - b[key])[middle][key]
  return { rps: value('rps'), latencyMs: value('latencyMs'), throughputMb: value('throughputMb') }
}

function format(value: number): string {
  return Math.round(value).toLocaleString('en-US')
}

function delta(value: number, baseline: number): string {
  const percent = (value / baseline - 1) * 100
  return `${percent >= 0 ? '+' : ''}${percent.toFixed(1)}%`
}

async function main(): Promise<void> {
  if (!Number.isInteger(TRIES) || TRIES < 1)
    throw new Error('BENCH_TRIES must be a positive integer')
  const toolVersion = ohaVersion()
  const systemInfo = [
    `CPU:        ${cpus()[0]?.model ?? 'unknown'}`,
    `Node.js:    ${process.version}`,
    `OS:         ${process.platform} ${process.arch}`,
    `OHA:        ${toolVersion}`,
    `Config:     ${CONNECTIONS} connections, ${WARMUP_DURATION} warmup, ${TRIES} × ${DURATION}`,
  ].join('\n')
  console.log(systemInfo)

  const results: ServerResult[] = []
  for (const server of [...servers].sort(() => Math.random() - 0.5)) {
    console.log(`\n${server.name}`)
    const child = spawn(process.execPath, [server.file], { stdio: ['ignore', 'ignore', 'inherit'] })
    try {
      await waitForServer()
      for (const scenario of scenarios) await verifyScenario(scenario)

      const scenarioResults = new Map<string, Sample>()
      for (const scenario of scenarios) {
        runLoad(scenario, WARMUP_DURATION)
        const samples = Array.from({ length: TRIES }, () => runLoad(scenario, DURATION))
        const result = median(samples)
        scenarioResults.set(scenario.name, result)
        console.log(
          `  ${scenario.name.padEnd(20)} ${format(result.rps).padStart(10)} req/s  ` +
            `${result.latencyMs.toFixed(2).padStart(8)} ms  ${result.throughputMb.toFixed(1).padStart(8)} MiB/s`
        )
      }
      results.push({ server, peakRssMb: peakRssMb(child.pid), scenarios: scenarioResults })
    } finally {
      await stopServer(child)
    }
  }

  const baseline = results.find((result) => result.server.name === 'node:http')
  assert(baseline)
  const ordered = servers.map((server) => results.find((result) => result.server === server)!)
  const table = [
    `| Scenario | ${ordered.map((result) => result.server.name).join(' | ')} |`,
    `| --- | ${ordered.map(() => '---:').join(' | ')} |`,
  ]
  for (const scenario of scenarios) {
    const base = baseline.scenarios.get(scenario.name)!.rps
    const cells = ordered.map((result) => {
      const rps = result.scenarios.get(scenario.name)!.rps
      return result === baseline ? format(rps) : `${format(rps)} (${delta(rps, base)})`
    })
    table.push(`| ${scenario.name} | ${cells.join(' | ')} |`)
  }
  table.push(
    `| peak RSS (MiB) | ${ordered.map((result) => result.peakRssMb?.toFixed(1) ?? 'n/a').join(' | ')} |`
  )

  // Match srvx's headline ranking: one representative JSON round-trip result
  // per server, ordered by the median requests per second.
  const rankingScenario = 'JSON round trip'
  const ranking = [...results].sort(
    (a, b) => b.scenarios.get(rankingScenario)!.rps - a.scenarios.get(rankingScenario)!.rps
  )
  const rankingBaseline = baseline.scenarios.get(rankingScenario)!.rps
  const rankingTable = [
    '| Rank | Server | Requests/sec | vs node:http |',
    '| ---: | --- | ---: | ---: |',
    ...ranking.map((result, index) => {
      const rps = result.scenarios.get(rankingScenario)!.rps
      return `| ${index + 1} | ${result.server.name} | ${format(rps)} | ${result === baseline ? '—' : delta(rps, rankingBaseline)} |`
    }),
  ]

  console.log(
    `\nJSON round trip (median requests/sec)\n\n${rankingTable.join('\n')}` +
      `\n\nAll scenarios (median requests/sec; delta vs node:http)\n\n${table.join('\n')}`
  )

  if (process.argv.includes('--update')) {
    const readmePath = fileURLToPath(new URL('../README.md', import.meta.url))
    const readme = readFileSync(readmePath, 'utf8')
    const markers = /(<!--\s*automd:bench\s*-->)[\s\S]*?(<!--\s*\/automd\s*-->)/
    assert(markers.test(readme), 'README is missing the automd:bench markers')
    const generated =
      `\`\`\`text\n${systemInfo}\n\`\`\`\n\n` +
      `### JSON round trip\n\n${rankingTable.join('\n')}\n\n` +
      `### All scenarios\n\n${table.join('\n')}`
    writeFileSync(readmePath, readme.replace(markers, `$1\n\n${generated}\n\n$2`))
    console.log(`\nUpdated ${readmePath}`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exitCode = 1
})
