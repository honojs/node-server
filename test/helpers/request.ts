import { once } from 'node:events'
import { request as requestHTTP } from 'node:http'
import type { IncomingMessage, RequestOptions } from 'node:http'
import type { AddressInfo } from 'node:net'
import { Readable } from 'node:stream'
import { newHeadersFromIncoming } from '../../src/request'
import { GlobalResponse } from '../../src/response'
import type { ServerType } from '../../src/types'

export type ServerRequestInit = Omit<
  RequestOptions,
  'agent' | 'host' | 'hostname' | 'path' | 'port' | 'protocol'
> & {
  body?: string | Uint8Array
  path: string
}

export const requestServer = async (
  server: ServerType,
  init: ServerRequestInit
): Promise<Response> => {
  const address = server.address() as AddressInfo | null
  if (!address) {
    throw new Error('Server is not listening on a TCP address')
  }

  const { body, path, ...options } = init
  const request = requestHTTP({
    ...options,
    agent: false,
    hostname: address.address,
    path,
    port: address.port,
  })
  request.end(body)

  const [incoming] = (await once(request, 'response')) as [IncomingMessage]
  const status = incoming.statusCode
  if (!status) {
    throw new Error('Server response did not include a status code')
  }

  const responseBody =
    options.method?.toUpperCase() === 'HEAD' || [101, 204, 205, 304].includes(status)
      ? null
      : (Readable.toWeb(incoming) as ReadableStream<Uint8Array>)

  return new GlobalResponse(responseBody, {
    headers: newHeadersFromIncoming(incoming),
    status,
    statusText: incoming.statusMessage,
  })
}
