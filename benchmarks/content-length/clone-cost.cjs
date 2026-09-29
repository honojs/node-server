'use strict'
const variant = process.argv[2]
const make =
  variant === 'update'
    ? () => ({ 'Content-Type': 'application/json', 'Content-Length': 0 })
    : () => ({ 'Content-Type': 'application/json' })
const ops = {
  identity: (h) => h,
  clone: (h) => ({ ...h }),
  add: (h) => {
    h['Content-Length'] = 27
    return h
  },
  copyadd: (h) => {
    const c = { ...h }
    c['Content-Length'] = 27
    return c
  },
  update: (h) => {
    h['Content-Length'] = 27
    return h
  },
}
const op = ops[variant]
if (!op) throw Error('Unknown variant')
const batch = 4096
const input = new Array(batch)
const output = new Array(batch)
let sink = 0
function run(count) {
  let ns = 0n
  for (let start = 0; start < count; start += batch) {
    for (let i = 0; i < batch; i++) input[i] = make()
    const before = process.hrtime.bigint()
    for (let i = 0; i < batch; i++) output[i] = op(input[i])
    ns += process.hrtime.bigint() - before
    for (let i = 0; i < batch; i++)
      sink += output[i]['Content-Type'].length + (output[i]['Content-Length'] || 0)
  }
  return Number(ns) / (Math.ceil(count / batch) * batch)
}
run(500000)
const samples = Array.from({ length: 7 }, () => run(1000000)).sort((a, b) => a - b)
console.log(
  JSON.stringify({
    node: process.version,
    v8: process.versions.v8,
    variant,
    medianNs: samples[3],
    samples,
    batch,
    sink,
  })
)
