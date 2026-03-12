import { spawn } from 'node:child_process'
import { setTimeout } from 'node:timers/promises'

const PORT = 3000
const WARMUP_TIME = 1000

interface BenchmarkResult {
  name: string
  reqsPerSec: number
}

interface ServerResult {
  server: string
  runtime: string
  average: number
  ping: number
  query: number
  body: number
}

async function waitForServer(): Promise<void> {
  const maxRetries = 30
  for (let i = 0; i < maxRetries; i++) {
    try {
      const response = await fetch(`http://localhost:${PORT}`)
      if (response.ok) {
        console.log('✓ Server is ready\n')
        return
      }
    } catch (e) {
      await setTimeout(100)
    }
  }
  throw new Error('Server failed to start')
}

async function retryFetch(url: string, options?: RequestInit, retries = 0): Promise<Response> {
  try {
    return await fetch(url, options)
  } catch (e) {
    if (retries > 7) throw e
    await setTimeout(200)
    return retryFetch(url, options, retries + 1)
  }
}

async function testEndpoints(): Promise<void> {
  // Test GET /
  const res1 = await retryFetch('http://127.0.0.1:3000/')
  const text1 = await res1.text()
  if (res1.status !== 200 || text1 !== 'Hi') {
    throw new Error(`Index: Result not match - expected "Hi", got "${text1}"`)
  }

  // Test GET /id/:id
  const res2 = await retryFetch('http://127.0.0.1:3000/id/1?name=bun')
  const text2 = await res2.text()
  if (res2.status !== 200 || text2 !== '1 bun') {
    throw new Error(`Query: Result not match - expected "1 bun", got "${text2}"`)
  }
  if (!res2.headers.get('x-powered-by')?.includes('benchmark')) {
    throw new Error('Query: X-Powered-By not match')
  }

  // Test POST /json
  const body = { hello: 'world' }
  const res3 = await retryFetch('http://127.0.0.1:3000/json', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json3 = await res3.json()
  if (res3.status !== 200 || JSON.stringify(json3) !== JSON.stringify(body)) {
    throw new Error(
      `Body: Result not match - expected ${JSON.stringify(body)}, got ${JSON.stringify(json3)}`
    )
  }
}

async function runBenchmarkForServer(
  serverFile: string,
  serverName: string
): Promise<ServerResult> {
  console.log(`\n${'='.repeat(60)}`)
  console.log(`Starting ${serverName}...`)
  console.log('='.repeat(60))

  const server = spawn('node', [serverFile], {
    stdio: 'inherit',
    cwd: process.cwd(),
  })

  try {
    await waitForServer()
    await setTimeout(WARMUP_TIME)

    await testEndpoints()

    console.log('Running benchmarks...\n')

    const benchmarks = [
      { name: 'GET /', url: 'http://127.0.0.1:3000/' },
      { name: 'GET /id/:id', url: 'http://127.0.0.1:3000/id/1?name=bun' },
      { name: 'POST /json', url: 'http://127.0.0.1:3000/json', method: 'POST' },
    ]

    const results: BenchmarkResult[] = []

    for (const bench of benchmarks) {
      const args = ['--fasthttp', '-c', '500', '-d', '10s']
      if (bench.method === 'POST') {
        args.push('-m', 'POST', '-H', 'Content-Type:application/json', '-f', './scripts/body.json')
      }
      args.push(bench.url)

      const output = await new Promise<string>((resolve, reject) => {
        let stdout = ''
        const bombardier = spawn('bombardier', args)

        bombardier.stdout?.on('data', (data) => {
          const text = data.toString()
          process.stdout.write(text)
          stdout += text
        })

        bombardier.stderr?.on('data', (data) => {
          process.stderr.write(data)
        })

        bombardier.on('close', (code) => {
          if (code === 0) resolve(stdout)
          else reject(new Error(`bombardier exited with code ${code}`))
        })
      })

      // Parse output
      const reqsMatch = output.match(/Reqs\/sec\s+([\d.]+)/)

      results.push({
        name: bench.name,
        reqsPerSec: reqsMatch ? parseFloat(reqsMatch[1]) : 0,
      })
    }

    console.log('\n✓ All benchmarks completed')

    const ping = results[0]?.reqsPerSec || 0
    const query = results[1]?.reqsPerSec || 0
    const body = results[2]?.reqsPerSec || 0
    const average = (ping + query + body) / 3

    return {
      server: serverName,
      runtime: 'node',
      average,
      ping,
      query,
      body,
    }
  } catch (error) {
    console.error('Error:', (error as Error).message)
    throw error
  } finally {
    console.log('Stopping server...')
    server.kill()
    await setTimeout(1000)
  }
}

async function testServer(serverFile: string, serverName: string): Promise<boolean> {
  console.log(`Testing ${serverName}...`)

  const server = spawn('node', [serverFile], {
    stdio: 'inherit',
    cwd: process.cwd(),
  })

  try {
    await waitForServer()
    await testEndpoints()
    console.log(`✅ ${serverName}`)
    return true
  } catch (error) {
    console.log(`❌ ${serverName}`)
    console.log('  ', (error as Error)?.message || error)
    return false
  } finally {
    server.kill()
    await setTimeout(1000)
  }
}

async function main(): Promise<void> {
  const servers = [
    { file: 'src/server-npm.js', name: '@hono/node-server (npm)' },
    { file: 'src/server-dev.js', name: '@hono/node-server (dev)' },
  ]

  console.log('\n' + '='.repeat(60))
  console.log('TEST PHASE')
  console.log('='.repeat(60) + '\n')

  const validServers = []
  for (const server of servers) {
    const isValid = await testServer(server.file, server.name)
    if (isValid) {
      validServers.push(server)
    }
  }

  if (validServers.length === 0) {
    console.error('\n❌ No servers passed the tests')
    process.exit(1)
  }

  console.log(`\n✓ ${validServers.length} server(s) passed the tests`)
  console.log('\n' + '='.repeat(60))
  console.log('BENCHMARK PHASE')
  console.log('='.repeat(60))

  const allResults: ServerResult[] = []

  try {
    for (const server of validServers) {
      const result = await runBenchmarkForServer(server.file, server.name)
      allResults.push(result)
    }

    // Print comparison table
    console.log('\n' + '='.repeat(60))
    console.log('BENCHMARK RESULTS')
    console.log('='.repeat(60) + '\n')

    const formatNumber = (num: number): string => {
      return num.toLocaleString('en-US', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })
    }

    const formatDiff = (npm: number, dev: number): string => {
      const diff = ((dev - npm) / npm) * 100
      const sign = diff > 0 ? '+' : ''
      return `${sign}${diff.toFixed(2)}%`
    }

    if (allResults.length === 2) {
      // Comparison mode: npm vs dev
      const npmResult = allResults.find((r) => r.server.includes('npm'))
      const devResult = allResults.find((r) => r.server.includes('dev'))

      if (npmResult && devResult) {
        console.log('| Benchmark         | npm            | dev            | Difference  |')
        console.log('| ----------------- | -------------- | -------------- | ----------- |')
        console.log(
          `| Average           | ${formatNumber(npmResult.average).padEnd(14)} | ${formatNumber(devResult.average).padEnd(14)} | ${formatDiff(npmResult.average, devResult.average).padEnd(11)} |`
        )
        console.log(
          `| Ping (GET /)      | ${formatNumber(npmResult.ping).padEnd(14)} | ${formatNumber(devResult.ping).padEnd(14)} | ${formatDiff(npmResult.ping, devResult.ping).padEnd(11)} |`
        )
        console.log(
          `| Query (GET /id)   | ${formatNumber(npmResult.query).padEnd(14)} | ${formatNumber(devResult.query).padEnd(14)} | ${formatDiff(npmResult.query, devResult.query).padEnd(11)} |`
        )
        console.log(
          `| Body (POST /json) | ${formatNumber(npmResult.body).padEnd(14)} | ${formatNumber(devResult.body).padEnd(14)} | ${formatDiff(npmResult.body, devResult.body).padEnd(11)} |`
        )
      }
    } else {
      // Fallback: original table format
      console.log(
        '|  Server                    | Runtime | Average      | Ping         | Query        | Body         |'
      )
      console.log(
        '| -------------------------- | ------- | ------------ | ------------ | ------------ | ------------ |'
      )

      const sortedResults = allResults.sort((a, b) => b.average - a.average)

      for (const result of sortedResults) {
        console.log(
          `| ${result.server.padEnd(26)} | ${result.runtime.padEnd(7)} | ${formatNumber(result.average).padEnd(12)} | ${formatNumber(result.ping).padEnd(12)} | ${formatNumber(result.query).padEnd(12)} | ${formatNumber(result.body).padEnd(12)} |`
        )
      }
    }

    console.log()
  } catch (error) {
    console.error('Failed to run benchmarks:', (error as Error).message)
    process.exit(1)
  }
}

main()
