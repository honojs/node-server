import { createServer as createServerHTTP, Server } from 'node:http'
import { Options } from './types'
import { getRequestListener } from './listener'
import type { AddressInfo } from 'node:net'

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
