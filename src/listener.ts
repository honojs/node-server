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
}
;[
  'body',
  'bodyUsed',
  'headers',
  'ok',
  'redirected',
  'statusText',
  'trailers',
  'type',
  'url',
].forEach((k) => {
  Object.defineProperty(responsePrototype, k, {
    get() {
      return this.getResponseCache()[k]
    },
  })
})
;['arrayBuffer', 'blob', 'clone', 'error', 'formData', 'json', 'redirect', 'text'].forEach((k) => {
  Object.defineProperty(responsePrototype, k, {
    value: function () {
      return this.getResponseCache()[k]()
    },
  })
})

function newResponse(this: Response, body: BodyInit | null, init?: ResponseInit) {
  ;(this as any).status = init?.status || 200
  ;(this as any).__body = body
  ;(this as any).__init = init
  if (typeof body === 'string' || body instanceof ReadableStream) {
    ;(this as any).__cache = [body, (init?.headers || {}) as Record<string, string>]
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
}
;[
  'body',
  'bodyUsed',
  'cache',
  'credentials',
  'destination',
  'headers',
  'integrity',
  'mode',
  'redirect',
  'referrer',
  'referrerPolicy',
  'signal',
].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    get() {
      return this.getRequestCache()[k]
    },
  })
})
;['arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text'].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    value: function () {
      return this.getRequestCache()[k]()
    },
  })
})

const handleFetchError = (e: unknown): Response =>
  new Response(null, {
    status:
      e instanceof Error && (e.name === 'TimeoutError' || e.constructor.name === 'TimeoutError')
        ? 504 // timeout error emits 504 timeout
        : 500,
  })

const handleResponseError = (e: unknown, outgoing: ServerResponse | Http2ServerResponse) => {
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

const responseViaCache = (
  res: Response,
  outgoing: ServerResponse | Http2ServerResponse
): undefined | Promise<undefined> => {
  const [body, header] = (res as any).__cache
  outgoing.writeHead((res as Response).status, header)
  if (typeof body === 'string') {
    header['content-length'] ||= '' + Buffer.byteLength(body)
    outgoing.end(body)
  } else {
    return writeFromReadableStream(body, outgoing)?.catch(
      (e) => handleResponseError(e, outgoing) as undefined
    )
  }
}

const responseViaResponseObject = async (
  res: Response | Promise<Response>,
  outgoing: ServerResponse | Http2ServerResponse
) => {
  if (res instanceof Promise) {
    res = await res.catch(handleFetchError)
  }
  if ('__cache' in res) {
    try {
      return responseViaCache(res as Response, outgoing)
    } catch (e: unknown) {
      return handleResponseError(e, outgoing)
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
      handleResponseError(e, outgoing)
    }
  } else {
    outgoing.writeHead(res.status, resHeaderRecord)
    outgoing.end()
  }
}

export const getRequestListener = (fetchCallback: FetchCallback) => {
  return (
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: ServerResponse | Http2ServerResponse
  ) => {
    let res
    const req = Object.create(requestPrototype)
    req.method = incoming.method || 'GET'
    req.url = `http://${incoming.headers.host}${incoming.url}`
    req.incoming = incoming
    try {
      res = fetchCallback(req) as Response | Promise<Response>
      if ('__cache' in res) {
        return responseViaCache(res as Response, outgoing)
      }
    } catch (e: unknown) {
      if (!res) {
        res = handleFetchError(e)
      } else {
        return handleResponseError(e, outgoing)
      }
    }

    return responseViaResponseObject(res, outgoing)
  }
}
