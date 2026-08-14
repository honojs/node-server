import { FastResponse, serve } from 'srvx'
import app from './app.js'

const port = 3000

// opt into srvx fast response, since hono uses request/response shims by default
globalThis.Response = FastResponse

serve({
  fetch: app.fetch,
  port,
})
