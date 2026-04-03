import { Hono } from 'hono'
import { serve } from '@hono/node-server-dev'

const app = new Hono()

app.get('/', (c) => c.text('Hi'))

app.get('/id/:id', (c) => {
  const id = c.req.param('id')
  const name = c.req.query('name')
  return c.text(`${id} ${name}`, 200, { 'x-powered-by': 'benchmark' })
})

app.post('/json', async (c) => {
  const body = await c.req.json()
  return c.json(body)
})

const port = 3000

serve({ fetch: app.fetch, port }, () => {
  console.log(`Listening on http://localhost:${port}`)
})
