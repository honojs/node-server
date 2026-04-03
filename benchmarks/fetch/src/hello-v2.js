import { serve } from '@hono/node-server-dev'

serve(
  {
    fetch() {
      return Response.json({ hello: 'world' })
    },
    port: 3000,
  },
  () => {
    console.log('Listening on http://localhost:3000')
  }
)
