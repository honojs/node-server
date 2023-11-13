import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { Readable } from 'node:stream'
import type { FetchCallback } from './types'
import './globals'
import { writeFromReadableStream } from './utils'

const regBuffer = /^no$/i
const regContentType = /^(application\/json\b|text\/(?!event-stream\b))/i

class CustomResponse extends global.Response {
  public __cache: [string, Record<string, string>] | undefined
  constructor(body: BodyInit | null, init?: ResponseInit) {
    super(body, init)
    if (typeof body === 'string' && !(init?.headers instanceof Headers)) {
      this.__cache = [body, (init?.headers || {}) as Record<string, string>]
    }
  }
  get headers() {
    // discard cache if headers are retrieved as they may change
    this.__cache = undefined
    return super.headers
  }
}
Object.defineProperty(global, 'Response', {
  value: CustomResponse,
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
  request() {
    return (this.requestCache ||= newRequestFromIncoming(this.method, this.url, this.incoming))
  },
  get body() {
    return this.request().body
  },
  get bodyUsed() {
    return this.request().bodyUsed
  },
  get cache() {
    return this.request().cache
  },
  get credentials() {
    return this.request().credentials
  },
  get destination() {
    return this.request().destination
  },
  get headers() {
    return this.request().headers
  },
  get integrity() {
    return this.request().integrity
  },
  get mode() {
    return this.request().mode
  },
  get redirect() {
    return this.request().redirect
  },
  get referrer() {
    return this.request().referrer
  },
  get referrerPolicy() {
    return this.request().referrerPolicy
  },
  get signal() {
    return this.request().signal
  },
  arrayBuffer() {
    return this.request().arrayBuffer()
  },
  blob() {
    return this.request().blob()
  },
  clone() {
    return this.request().clone()
  },
  formData() {
    return this.request().formData()
  },
  json() {
    return this.request().json()
  },
  text() {
    return this.request().text()
  },
}

export const getRequestListener = (fetchCallback: FetchCallback) => {
  return async (
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: ServerResponse | Http2ServerResponse
  ) => {
    let res: CustomResponse
    const req = {
      method: incoming.method || 'GET',
      url: `http://${incoming.headers.host}${incoming.url}`,
      incoming,
    } as unknown as Request
    Object.setPrototypeOf(req, requestPrototype)
    try {
      res = (await fetchCallback(req)) as CustomResponse
    } catch (e: unknown) {
      res = new CustomResponse(null, { status: 500 })
      if (e instanceof Error) {
        // timeout error emits 504 timeout
        if (e.name === 'TimeoutError' || e.constructor.name === 'TimeoutError') {
          res = new CustomResponse(null, { status: 504 })
        }
      }
    }

    if (res.__cache) {
      const [body, header] = res.__cache
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
