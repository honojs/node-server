import { Hono } from 'hono'
import { serve } from '@hono/node-server-dev'

const app = new Hono()

app.get('/', (c) => c.json({ hello: 'world' }))

serve({ fetch: app.fetch, port: 3000 }, () => {
  console.log('Listening on http://localhost:3000')
})
