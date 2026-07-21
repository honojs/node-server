import { once } from 'node:events'
import { request as requestHTTP } from 'node:http'
import type { IncomingMessage, RequestOptions } from 'node:http'
import { connect } from 'node:http2'
import type { IncomingHttpHeaders as IncomingHttp2Headers } from 'node:http2'
import { Server as HttpsServer, request as requestHTTPS } from 'node:https'
import type { AddressInfo } from 'node:net'
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

export type ServerRequestHooks = {
  onHeaders?: (headers: Headers, status: number) => void
  onChunk?: (chunk: Buffer, index: number) => void
}

export type Http2RequestInit = {
  headers?: Record<string, string>
  method?: string
  path: string
}

const ensureListening = async (server: ServerType) => {
  let address = server.address() as AddressInfo | null
  let startedByHelper = false
  if (!address) {
    server.listen(0, '127.0.0.1')
    await once(server, 'listening')
    startedByHelper = true
    address = server.address() as AddressInfo | null
  }
  if (!address) {
    throw new Error('Server is not listening on a TCP address')
  }

  return {
    address,
    // a no-op if the server was already listening before the request, its
    // owner is responsible for closing it in that case
    close: async () => {
      if (startedByHelper) {
        await new Promise<void>((resolve) => server.close(() => resolve()))
      }
    },
  }
}

const sendRequest = (server: ServerType, address: AddressInfo, init: ServerRequestInit) => {
  const { body, path, ...options } = init
  const common = {
    ...options,
    agent: false,
    hostname: address.address,
    path,
    port: address.port,
  }
  const request =
    server instanceof HttpsServer
      ? requestHTTPS({ ...common, rejectUnauthorized: false })
      : requestHTTP(common)
  request.end(body)
  return request
}

const receiveResponse = async (request: ReturnType<typeof sendRequest>) => {
  const [incoming] = (await once(request, 'response')) as [IncomingMessage]
  const status = incoming.statusCode
  if (!status) {
    throw new Error('Server response did not include a status code')
  }
  return { incoming, status }
}

export const requestServer = async (
  server: ServerType,
  init: ServerRequestInit
): Promise<Response> => {
  const { address, close } = await ensureListening(server)

  // the request may fail mid-flight (e.g. aborted via `init.signal`), so the
  // helper-started server is always fully closed before returning or
  // surfacing an error
  try {
    const { incoming, status } = await receiveResponse(sendRequest(server, address, init))

    const hasBody = init.method?.toUpperCase() !== 'HEAD' && ![101, 204, 205, 304].includes(status)

    let responseBody: BodyInit | null = null
    if (hasBody) {
      // buffer the body so a helper-started server can be fully closed before
      // returning, otherwise a subsequent request could hit a half-closed server
      const chunks: Buffer[] = []
      for await (const chunk of incoming) {
        chunks.push(chunk)
      }
      responseBody = new Uint8Array(Buffer.concat(chunks))
    }

    return new GlobalResponse(responseBody, {
      headers: newHeadersFromIncoming(incoming),
      status,
      statusText: incoming.statusMessage,
    })
  } finally {
    await close()
  }
}

/**
 * Same as `requestServer`, but exposes the raw body chunks for tests that
 * assert streaming behavior: `onHeaders` fires before any body data arrives
 * and `onChunk` fires per received chunk, so a test can synchronize with the
 * server mid-response. Chunk boundaries are preserved by the chunked
 * transfer-encoding framing.
 */
export const requestServerChunked = async (
  server: ServerType,
  init: ServerRequestInit,
  hooks: ServerRequestHooks = {}
): Promise<{ chunks: Buffer[]; response: Response }> => {
  const { address, close } = await ensureListening(server)

  try {
    const { incoming, status } = await receiveResponse(sendRequest(server, address, init))
    const headers = newHeadersFromIncoming(incoming)
    hooks.onHeaders?.(headers, status)

    const chunks: Buffer[] = []
    incoming.on('data', (chunk: Buffer) => {
      hooks.onChunk?.(chunk, chunks.length)
      chunks.push(chunk)
    })
    await once(incoming, 'end')

    return {
      chunks,
      response: new GlobalResponse(new Uint8Array(Buffer.concat(chunks)), {
        headers,
        status,
        statusText: incoming.statusMessage,
      }),
    }
  } finally {
    await close()
  }
}

export const requestServerHttp2 = async (
  server: ServerType,
  init: Http2RequestInit
): Promise<Response> => {
  const { address, close } = await ensureListening(server)
  const client = connect(`http://${address.address}:${address.port}`)
  // stream errors reject `once()` below, a session error would otherwise crash
  client.once('error', () => {})

  try {
    const stream = client.request({
      ':method': init.method ?? 'GET',
      ':path': init.path,
      ...init.headers,
    })
    stream.end()

    const [incomingHeaders, , rawHeaders] = (await once(stream, 'response')) as [
      IncomingHttp2Headers,
      number,
      string[],
    ]
    const status = Number(incomingHeaders[':status'])
    const headers = newHeadersFromIncoming({ rawHeaders })

    const chunks: Buffer[] = []
    stream.on('data', (chunk: Buffer) => chunks.push(chunk))
    await once(stream, 'end')

    return new GlobalResponse(new Uint8Array(Buffer.concat(chunks)), { headers, status })
  } finally {
    client.close()
    await close()
  }
}
