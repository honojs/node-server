import { createServer as createServerHTTP, Server } from 'node:http'

import { installGlobals } from './globals'
import { Options } from './types'
import { getRequestListener } from './listener'

installGlobals()

export const createAdaptorServer = (options: Options): Server => {
  const fetchCallback = options.fetch
  const requestListener = getRequestListener(fetchCallback)
  const createServer = options.creteServer || createServerHTTP
  const server: Server = createServer(options.serverOptions || {}, requestListener)
  return server
}

export const serve = (options: Options): Server => {
  const server = createAdaptorServer(options)
  server.listen(options.port || 3000, options.hostname || '0.0.0.0')
  return server
}
