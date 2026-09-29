import { execFileSync } from 'node:child_process'
import { appendFileSync, existsSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// Pass fixed Node executables to compare engine versions. Each case gets a
// fresh process, with rotating case order and alternating version order.
const nodes = process.argv.slice(2)
if (!nodes.length) nodes.push(process.execPath)
const output =
  process.env.BENCH_RESULTS || fileURLToPath(new URL('./.work/clone-cost.jsonl', import.meta.url))
if (existsSync(output)) throw new Error(`Refusing to overwrite ${output}`)
const worker = fileURLToPath(new URL('./clone-cost.cjs', import.meta.url))
const variants = ['identity', 'clone', 'add', 'copyadd', 'update']
for (let round = 0; round < 5; round++) {
  for (const node of round % 2 ? [...nodes].reverse() : nodes) {
    for (let k = 0; k < variants.length; k++) {
      const variant = variants[(k + round) % variants.length]
      const row = {
        round,
        ...JSON.parse(execFileSync(node, [worker, variant], { encoding: 'utf8' })),
      }
      appendFileSync(output, JSON.stringify(row) + '\n')
    }
  }
  console.log(`Completed round ${round + 1}`)
}
