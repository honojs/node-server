import { Response as PonyfillResponse } from '@whatwg-node/fetch'
import { Hono } from 'hono'

export const app = new Hono()

app.get('/', (c) => c.text('Hello! Node!'))
app.get('/url', (c) => c.text(c.req.url))

app.get('/posts', (c) => {
  return c.text(`Page ${c.req.query('page')}`)
})
app.get('/user-agent', (c) => {
  return c.text(c.req.header('user-agent') as string)
})
app.post('/posts', (c) => {
  return c.redirect('/posts')
})
app.post('/body-consumed', async (c) => {
  return c.text(`Body length: ${(await c.req.text()).length}`)
})
app.post('/no-body-consumed', (c) => {
  if (!c.req.raw.body) {
    // force create new request object
    throw new Error('No body consumed')
  }
  return c.text('No body consumed')
})
app.post('/body-cancelled', (c) => {
  if (!c.req.raw.body) {
    // force create new request object
    throw new Error('No body consumed')
  }
  c.req.raw.body.cancel()
  return c.text('Body cancelled')
})
app.post('/partially-consumed', async (c) => {
  if (!c.req.raw.body) {
    // force create new request object
    throw new Error('No body consumed')
  }
  const reader = c.req.raw.body.getReader()
  await reader.read() // read only one chunk
  return c.text('Partially consumed')
})
app.post('/partially-consumed-and-cancelled', async (c) => {
  if (!c.req.raw.body) {
    // force create new request object
    throw new Error('No body consumed')
  }
  const reader = c.req.raw.body.getReader()
  await reader.read() // read only one chunk
  reader.cancel()
  return c.text('Partially consumed and cancelled')
})
app.delete('/posts/:id', (c) => {
  return c.text(`DELETE ${c.req.param('id')}`)
})
// @ts-expect-error the response is string
app.get('/invalid', () => {
  return '<h1>HTML</h1>'
})
app.get('/ponyfill', () => {
  return new PonyfillResponse('Pony')
})

app.on('trace', '/', (c) => {
  const headers = c.req.raw.headers // build new request object
  return c.text(`headers: ${JSON.stringify(headers)}`)
})
