import { createServer as createServerHTTP, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import type { Options } from './types'
import { getRequestListener } from './listener'

export const createAdaptorServer = (options: Options): Server => {
  const fetchCallback = options.fetch
  const requestListener = getRequestListener(fetchCallback)
  const createServer = options.createServer || createServerHTTP
  const server: Server = createServer(options.serverOptions || {}, requestListener)
  return server
}

export const serve = (options: Options, listeningListener?: (info: AddressInfo) => void): Server => {
  const server = createAdaptorServer(options);
  server.listen(options?.port ?? 3000, options.hostname ?? '0.0.0.0', () => {
    const serverInfo = server.address() as AddressInfo;
    listeningListener && listeningListener(serverInfo);
  })
  return server
}
