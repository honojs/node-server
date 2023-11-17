import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable } from 'node:stream'
import type { FetchCallback } from './types'
import './globals'
import { getResponseInternalBody, writeFromReadableStream } from './utils'

export const getRequestListener = (fetchCallback: FetchCallback) => {
  return async (
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: ServerResponse | Http2ServerResponse
  ) => {
    const method = incoming.method || 'GET'
    const url = `http://${incoming.headers.host}${incoming.url}`

    const headerRecord: [string, string][] = []
    const len = incoming.rawHeaders.length
    for (let i = 0; i < len; i += 2) {
      headerRecord.push([incoming.rawHeaders[i], incoming.rawHeaders[i + 1]])
    }

    const init = {
      method: method,
      headers: headerRecord,
    } as RequestInit

    if (!(method === 'GET' || method === 'HEAD')) {
      // lazy-consume request body
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      // node 18 fetch needs half duplex mode when request body is stream
      ;(init as any).duplex = 'half'
    }

    const request = new Request(url, init)
    let res: Response

    try {
      const resOrPromise = fetchCallback(request) as Response | Promise<Response>
      // in order to avoid another await for response
      res = resOrPromise instanceof Response ? resOrPromise : await resOrPromise
    } catch (e: unknown) {
      res = new Response(null, { status: 500 })
      if (e instanceof Error) {
        // timeout error emits 504 timeout
        if (e.name === 'TimeoutError' || e.constructor.name === 'TimeoutError') {
          res = new Response(null, { status: 504 })
        }
      }
    }

    const resHeaderRecord: OutgoingHttpHeaders = {}
    const cookies = []
    for (const [k, v] of res.headers) {
      if (k === 'set-cookie') {
        cookies.push(v)
      } else {
        resHeaderRecord[k] = v
      }
    }
    if (cookies.length > 0) {
      resHeaderRecord['Set-Cookie'] = cookies
    }

    // figure out the internal body source
    let body: Uint8Array | string | null = null
    let stream = res.body

    // try to get the native nodejs internal body state if we can
    let { source = null, length = null } = getResponseInternalBody(res) || {}

    if (typeof source === 'string' || source instanceof Uint8Array) {
      body = source
    }

    if (length !== null && body !== null && !res.headers.get('transfer-encoding')) {
      // we can directly use the internal body's source to write the response
      resHeaderRecord['Content-Length'] = length
      delete resHeaderRecord['content-encoding']
    }

    // do not write response if outgoing is already finished
    if (outgoing.destroyed || outgoing.writableEnded || outgoing.headersSent) {
      console.info('The response is already finished.')
      return
    }

    // now we can write the response headers and status
    outgoing.writeHead(res.status, resHeaderRecord)

    if (stream === null || method === 'HEAD' || res.status === 204 || res.status === 304) {
      outgoing.end()
    } else if (body != null) {
      outgoing.end(body)
    } else {
      try {
        await writeFromReadableStream(stream, outgoing)
      } catch (e: unknown) {
        const err = (e instanceof Error ? e : new Error('unknown error', { cause: e })) as Error & {
          code: string
        }
        if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
          console.info('The user aborted a request.')
        } else {
          console.error(e)
          outgoing.destroy(err)
        }
      }
    }
  }
}
