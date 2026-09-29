import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import { Hono } from 'hono'
import { headerPath } from './header-path.mjs'
const forceGC = process.env.BENCH_GC === 'forced'
const warmupIterations = Number(process.env.BENCH_WARMUP || 300000)
if (!Number.isSafeInteger(warmupIterations) || warmupIterations < 1)
  throw new Error('BENCH_WARMUP must be a positive integer')
const variant = process.argv[2]
const { getRequestListener } = await import(`./.work/dist/${variant}/index.mjs`)
class MeasuredResponse extends ServerResponse {
  end() {
    return this
  }
}
const request = new IncomingMessage(new Socket())
request.method = 'GET'
request.httpVersionMajor = 1
request.httpVersionMinor = 1
request.url = '/'
request.rawHeaders = ['Host', 'localhost']
request.headers = { host: 'localhost' }
const payload = { message: 'Hello, world!' }
const cases = {
  json: (c) => c.json(payload),
  json8: (c) =>
    c.json(payload, 200, {
      'x-a': '1',
      'x-b': '2',
      'x-c': '3',
      'x-d': '4',
      'x-e': '5',
      'x-f': '6',
      'x-g': '7',
    }),
  text: (c) => c.text('Hello, world!'),
}
let sink = 0
for (const [kind, handler] of Object.entries(cases)) {
  const app = new Hono().get('/', handler)
  const listener = getRequestListener(app.fetch)
  const headers = headerPath(await app.fetch(new Request('http://localhost/')))
  const run = async (count) => {
    const start = process.hrtime.bigint()
    for (let i = 0; i < count; i++) {
      const outgoing = new MeasuredResponse(request)
      await listener(request, outgoing)
      if (!outgoing._header) throw Error('Response was not synchronous')
      sink += outgoing._header.length
    }
    return Number(process.hrtime.bigint() - start) / count
  }
  await run(warmupIterations)
  const samples = []
  for (let i = 0; i < 5; i++) {
    if (forceGC) global.gc()
    samples.push(await run(200000))
  }
  samples.sort((a, b) => a - b)
  console.log(
    JSON.stringify({
      node: process.version,
      variant,
      gc: forceGC ? 'forced' : 'natural',
      warmupIterations,
      iterationsPerSample: 200000,
      sampleCount: 5,
      kind,
      headers,
      medianNs: +samples[2].toFixed(1),
      minNs: +samples[0].toFixed(1),
      maxNs: +samples.at(-1).toFixed(1),
      sink,
    })
  )
}
