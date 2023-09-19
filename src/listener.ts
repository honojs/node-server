import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { FetchCallback } from './types'
import './globals'

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

    let res: Response

    try {
      res = (await fetchCallback(new Request(url.toString(), init))) as Response
    } catch (e: unknown) {
      res = new Response(null, { status: 500 })
      if (e instanceof Error) {
        // timeout error emits 504 timeout
        if (e.name === 'TimeoutError' || e.constructor.name === 'TimeoutError') {
          res = new Response(null, { status: 504 })
        }
      }
    }

    const contentType = res.headers.get('content-type') || ''
    // nginx buffering variant
    const buffering = res.headers.get('x-accel-buffering') || ''
    const contentEncoding = res.headers.get('content-encoding')
    const contentLength = res.headers.get('content-length')
    const transferEncoding = res.headers.get('transfer-encoding')

    for (const [k, v] of res.headers) {
      if (k === 'set-cookie') {
        // node native Headers.prototype has getSetCookie method
        outgoing.setHeader(k, (res.headers as any).getSetCookie(k))
      } else {
        outgoing.setHeader(k, v)
      }
    }
    outgoing.statusCode = res.status

    if (res.body) {
      try {
        /**
         * If content-encoding is set, we assume that the response should be not decoded.
         * Else if transfer-encoding is set, we assume that the response should be streamed.
         * Else if content-length is set, we assume that the response content has been taken care of.
         * Else if x-accel-buffering is set to no, we assume that the response should be streamed.
         * Else if content-type is not application/json nor text/* but can be text/event-stream,
         * we assume that the response should be streamed.
         */
        if (
          contentEncoding ||
          transferEncoding ||
          contentLength ||
          /^no$/i.test(buffering) ||
          !/^(application\/json\b|text\/(?!event-stream\b))/i.test(contentType)
        ) {
          await pipeline(Readable.fromWeb(res.body as NodeReadableStream), outgoing)
        } else {
          const text = await res.text()
          outgoing.setHeader('Content-Length', Buffer.byteLength(text))
          outgoing.end(text)
        }
      } catch (e: unknown) {
        // try to catch any error, to avoid crash
        console.error(e)
      }
    } else {
      outgoing.end()
    }
  }
}
