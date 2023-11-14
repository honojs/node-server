import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable } from 'node:stream'
import type { FetchCallback } from './types'
import './globals'
import { writeFromReadableStream } from './utils'

const regBuffer = /^no$/i
const regContentType = /^(application\/json\b|text\/(?!event-stream\b))/i

const globalResponse = global.Response
const responsePrototype: Record<string, any> = {
  getResponseCache() {
    delete this.__cache
    return (this.responseCache ||= new globalResponse(this.__body, this.__init))
  },
  get body() {
    return this.getResponseCache().body
  },
  get bodyUsed() {
    return this.getResponseCache().bodyUsed
  },
  get headers() {
    return this.getResponseCache().headers
  },
  get ok() {
    return this.getResponseCache().ok
  },
  get redirected() {
    return this.getResponseCache().redirected
  },
  get statusText() {
    return this.getResponseCache().statusText
  },
  get trailers() {
    return this.getResponseCache().trailers
  },
  get type() {
    return this.getResponseCache().type
  },
  get url() {
    return this.getResponseCache().url
  },
  arrayBuffer() {
    return this.getResponseCache().arrayBuffer()
  },
  blob() {
    return this.getResponseCache().blob()
  },
  clone() {
    return this.getResponseCache().clone()
  },
  error() {
    return this.getResponseCache().error()
  },
  formData() {
    return this.getResponseCache().formData()
  },
  json() {
    return this.getResponseCache().json()
  },
  redirect() {
    return this.getResponseCache().redirect()
  },
  text() {
    return this.getResponseCache().text()
  },
}

function newResponse(this: Response, body: BodyInit | null, init?: ResponseInit) {
  Object.assign(this, {
    status: init?.status || 200,
    __body: body,
    __init: init,
    __cache: [body, (init?.headers || {}) as Record<string, string>],
  })
  if (typeof body !== 'string') {
    delete (this as any).__cache
  }
}
newResponse.prototype = responsePrototype
Object.defineProperty(global, 'Response', {
  value: newResponse,
})

function newRequestFromIncoming(
  method: string,
  url: string,
  incoming: IncomingMessage | Http2ServerRequest
): Request {
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

  return new Request(url, init)
}

const requestPrototype: Record<string, any> = {
  getRequestCache() {
    return (this.requestCache ||= newRequestFromIncoming(this.method, this.url, this.incoming))
  },
  get body() {
    return this.getRequestCache().body
  },
  get bodyUsed() {
    return this.getRequestCache().bodyUsed
  },
  get cache() {
    return this.getRequestCache().cache
  },
  get credentials() {
    return this.getRequestCache().credentials
  },
  get destination() {
    return this.getRequestCache().destination
  },
  get headers() {
    return this.getRequestCache().headers
  },
  get integrity() {
    return this.getRequestCache().integrity
  },
  get mode() {
    return this.getRequestCache().mode
  },
  get redirect() {
    return this.getRequestCache().redirect
  },
  get referrer() {
    return this.getRequestCache().referrer
  },
  get referrerPolicy() {
    return this.getRequestCache().referrerPolicy
  },
  get signal() {
    return this.getRequestCache().signal
  },
  arrayBuffer() {
    return this.getRequestCache().arrayBuffer()
  },
  blob() {
    return this.getRequestCache().blob()
  },
  clone() {
    return this.getRequestCache().clone()
  },
  formData() {
    return this.getRequestCache().formData()
  },
  json() {
    return this.getRequestCache().json()
  },
  text() {
    return this.getRequestCache().text()
  },
}

export const getRequestListener = (fetchCallback: FetchCallback) => {
  return async (
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: ServerResponse | Http2ServerResponse
  ) => {
    let res
    const req = {
      method: incoming.method || 'GET',
      url: `http://${incoming.headers.host}${incoming.url}`,
      incoming,
    } as unknown as Request
    Object.setPrototypeOf(req, requestPrototype)
    try {
      res = (await fetchCallback(req)) as Response
    } catch (e: unknown) {
      res = new Response(null, { status: 500 })
      if (e instanceof Error) {
        // timeout error emits 504 timeout
        if (e.name === 'TimeoutError' || e.constructor.name === 'TimeoutError') {
          res = new Response(null, { status: 504 })
        }
      }
    }

    if ((res as any).__cache) {
      const [body, header] = (res as any).__cache
      header['content-length'] ||= '' + Buffer.byteLength(body)
      outgoing.writeHead(res.status, header)
      outgoing.end(body)
      return
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
      resHeaderRecord['set-cookie'] = cookies
    }

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
          (resHeaderRecord['x-accel-buffering'] &&
            regBuffer.test(resHeaderRecord['x-accel-buffering'] as string)) ||
          !regContentType.test(resHeaderRecord['content-type'] as string)
        ) {
          outgoing.writeHead(res.status, resHeaderRecord)
          await writeFromReadableStream(res.body, outgoing)
        } else {
          const buffer = await res.arrayBuffer()
          resHeaderRecord['content-length'] = buffer.byteLength
          outgoing.writeHead(res.status, resHeaderRecord)
          outgoing.end(new Uint8Array(buffer))
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
      outgoing.writeHead(res.status, resHeaderRecord)
      outgoing.end()
    }
  }
}
