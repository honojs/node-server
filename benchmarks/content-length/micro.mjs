import { ServerResponse } from 'node:http'
const forceGC = process.env.BENCH_GC === 'forced'
const warmupIterations = Number(process.env.BENCH_WARMUP || 300000)
if (!Number.isSafeInteger(warmupIterations) || warmupIterations < 1)
  throw new Error('BENCH_WARMUP must be a positive integer')
const variant = process.argv[2]
const { responseViaCache, LightweightResponse } = await import(`./.work/dist/${variant}/index.mjs`)
class MeasuredResponse extends ServerResponse {
  end() {
    return this
  }
}
const request = { method: 'GET', httpVersionMajor: 1, httpVersionMinor: 1 }
const factories = {
  plain1: () => ({ 'content-type': 'text/plain' }),
  plain8: () => ({
    'content-type': 'text/plain',
    'x-a': '1',
    'x-b': '2',
    'x-c': '3',
    'x-d': '4',
    'x-e': '5',
    'x-f': '6',
    'x-g': '7',
  }),
  noheaders: () => undefined,
}
let sink = 0
for (const [kind, makeHeaders] of Object.entries(factories)) {
  const run = (count) => {
    const start = process.hrtime.bigint()
    for (let i = 0; i < count; i++) {
      const headers = makeHeaders()
      const outgoing = new MeasuredResponse(request)
      responseViaCache(new LightweightResponse('hello', { headers }), outgoing)
      sink += outgoing._header.length
    }
    return Number(process.hrtime.bigint() - start) / count
  }
  run(warmupIterations)
  const samples = []
  for (let i = 0; i < 5; i++) {
    if (forceGC) global.gc()
    samples.push(run(200000))
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
      medianNs: +samples[2].toFixed(1),
      minNs: +samples[0].toFixed(1),
      maxNs: +samples.at(-1).toFixed(1),
      sink,
    })
  )
}
