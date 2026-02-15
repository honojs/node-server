import { serve } from '@hono/node-server-dev'
import app from './app.js'

const port = 3000

serve(
  {
    fetch: app.fetch,
    port,
  },
  () => {
    console.log(`Listening on http://localhost:${port}`)
  }
)
