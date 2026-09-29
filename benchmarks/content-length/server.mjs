import { Hono } from 'hono'
import { headerPath } from './header-path.mjs'
const { createAdaptorServer } = await import(`./.work/dist/${process.argv[2]}/index.mjs`)
const app = new Hono()
const payload = { message: 'Hello, world!' }
app.get('/json', (c) => c.json(payload))
app.get('/json8', (c) =>
  c.json(payload, 200, {
    'x-a': '1',
    'x-b': '2',
    'x-c': '3',
    'x-d': '4',
    'x-e': '5',
    'x-f': '6',
    'x-g': '7',
  })
)
app.get('/text', (c) => c.text('Hello, world!'))
const server = createAdaptorServer({ fetch: app.fetch })
const headerPaths = {}
for (const kind of ['json', 'json8', 'text']) {
  headerPaths[kind] = headerPath(await app.fetch(new Request(`http://localhost/${kind}`)))
}
let start
process.on('message', (message) => {
  if (message === 'start') {
    start = process.cpuUsage()
    process.send('started')
  }
  if (message === 'end')
    process.send({ cpu: process.cpuUsage(start), memory: process.memoryUsage() })
  if (message === 'stop') server.close(() => process.exit())
})
server.listen(0, '127.0.0.1', () =>
  process.send({
    port: server.address().port,
    node: process.version,
    v8: process.versions.v8,
    headerPaths,
  })
)
