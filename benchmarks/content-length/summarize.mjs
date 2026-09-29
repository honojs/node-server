import { readFileSync } from 'node:fs'
const groups = new Map()
for (const path of process.argv.slice(2)) {
  for (const line of readFileSync(path, 'utf8').trim().split('\n')) {
    const row = JSON.parse(line)
    const mode =
      row.mode ||
      (row.benchmark
        ? 'http'
        : ['plain1', 'plain8', 'noheaders'].includes(row.kind)
          ? 'micro'
          : 'pipeline')
    const key = `${row.node} | ${row.hono || 'unrecorded'} | ${mode} | ${row.kind} | ${row.headers || 'unrecorded'}`
    if (!groups.has(key)) groups.set(key, {})
    const variants = groups.get(key)
    ;(variants[row.variant] ||= []).push(row)
  }
}
const median = (values) => {
  const sorted = values.toSorted((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2
}
console.log(
  '| Node | Hono | Mode | Case | Headers | Variant | n | Median (range) | Delta | CPU µs/request |\n|---|---|---|---|---|---|---:|---:|---:|---:|'
)
for (const [key, variants] of groups) {
  const http = !!variants.baseline[0].benchmark
  const metric = (r) =>
    http ? r.benchmark.result.req2xx / r.benchmark.result.timeTakenSeconds : r.medianNs
  const baseline = median(variants.baseline.map(metric))
  for (const [name, rows] of Object.entries(variants)) {
    const values = rows.map(metric)
    const mid = median(values)
    const cpu = http
      ? median(rows.map((r) => (r.cpu.user + r.cpu.system) / r.benchmark.result.req2xx)).toFixed(3)
      : '—'
    console.log(
      `| ${key} | ${name} | ${rows.length} | ${mid.toFixed(1)} (${Math.min(...values).toFixed(1)}–${Math.max(...values).toFixed(1)}) ${http ? 'req/s' : 'ns'} | ${((mid / baseline - 1) * 100).toFixed(2)}% | ${cpu} |`
    )
  }
}
