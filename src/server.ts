import { createServer, Server } from 'node:http'

import { installGlobals } from './globals'
import { Options } from './types'
import { getRequestListener } from './listener'
import type { AddressInfo } from 'node:net'

installGlobals()

export const createAdaptorServer = (options: Options): Server => {
  const fetchCallback = options.fetch
  const requestListener = getRequestListener(fetchCallback)
  const server: Server = createServer(options.serverOptions || {}, requestListener)
  return server
}

export const serve = (options: Options, listeningListener?:(port: number) => void): Server => {
  const server = createAdaptorServer(options);
  const serverInfo = server.address() as AddressInfo;
  const port = serverInfo?.port ?? options.port;
  server.listen(options.port || 3000, options.hostname || '0.0.0.0', () => {
    listeningListener && listeningListener(port);
  })
  return server
}
