import { createServer as createServerHTTP } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getRequestListener, getUpgradeListener } from './listener'
import type { Options, ServerType } from './types'

export const createAdaptorServer = (options: Options): ServerType => {
  const fetchCallback = options.fetch
  const upgrade = options.upgrade !== false
  const requestListener = getRequestListener(fetchCallback)
  // ts will complain about createServerHTTP and createServerHTTP2 not being callable, which works just fine
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const createServer: any = options.createServer || createServerHTTP
  const server: ServerType = createServer(options.serverOptions || {}, requestListener)
  if (upgrade) {
    server.on('upgrade', getUpgradeListener(requestListener))
  }
  return server
}

export const serve = (
  options: Options,
  listeningListener?: (info: AddressInfo) => void
): ServerType => {
  const server = createAdaptorServer(options)
  server.listen(options?.port ?? 3000, options.hostname ?? '0.0.0.0', () => {
    const serverInfo = server.address() as AddressInfo
    listeningListener && listeningListener(serverInfo)
  })
  return server
}
