import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import type { ReadableStream as NodeReadableStream } from 'node:stream/web'
import type { FetchCallback } from './types'
import './globals'

const regBuffer = /^no$/i
const regContentType = /^(application\/json\b|text\/(?!event-stream\b))/i

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

    const resHeaderRecord: Record<string, string> = {}
    for (const [k, v] of res.headers) {
      resHeaderRecord[k] = v
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
          resHeaderRecord['transfer-encoding'] ||
          resHeaderRecord['content-encoding'] ||
          resHeaderRecord['content-length'] ||
          // nginx buffering variant
          regBuffer.test(resHeaderRecord['x-accel-buffering']) ||
          !regContentType.test(resHeaderRecord['content-type'])
        ) {
          await pipeline(Readable.fromWeb(res.body as NodeReadableStream), outgoing)
        } else {
          const text = await res.text()
          outgoing.setHeader('Content-Length', Buffer.byteLength(text))
          outgoing.end(text)
        }
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
    } else {
      outgoing.end()
    }
  }
}
