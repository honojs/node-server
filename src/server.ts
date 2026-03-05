import { createServer as createServerHTTP } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getRequestListener } from './listener'
import type { Options, ServerType } from './types'
import { setupWebSocket } from './websocket'

export const createAdaptorServer = (options: Options): ServerType => {
  const fetchCallback = options.fetch
  const requestListener = getRequestListener(fetchCallback, {
    hostname: options.hostname,
    overrideGlobalObjects: options.overrideGlobalObjects,
    autoCleanupIncoming: options.autoCleanupIncoming,
  })
  // ts will complain about createServerHTTP and createServerHTTP2 not being callable, which works just fine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createServer: any = options.createServer || createServerHTTP
  const server: ServerType = createServer(options.serverOptions || {}, requestListener)
  if (options.websocket && options.websocket.server) {
    if (options.websocket.server.options.noServer !== true) 
      throw new Error('WebSocket server must be created with { noServer: true } option')
    setupWebSocket({ server, fetchCallback, wss: options.websocket.server })
  }
  return server
}

export const serve = (
  options: Options,
  listeningListener?: (info: AddressInfo) => void
): ServerType => {
  const server = createAdaptorServer(options)
  server.listen(options?.port ?? 3000, options.hostname, () => {
    const serverInfo = server.address() as AddressInfo
    listeningListener && listeningListener(serverInfo)
  })
  return server
}
