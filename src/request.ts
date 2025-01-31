/* eslint-disable @typescript-eslint/no-explicit-any */
// Define prototype for lightweight pseudo Request object

import type { IncomingMessage } from 'node:http'
import { Http2ServerRequest } from 'node:http2'
import { Readable } from 'node:stream'
import type { TLSSocket } from 'node:tls'

export class RequestError extends Error {
  static name = 'RequestError'
  constructor(
    message: string,
    options?: {
      cause?: unknown
    }
  ) {
    super(message, options)
  }
}

export const toRequestError = (e: unknown): RequestError => {
  if (e instanceof RequestError) {
    return e
  }
  return new RequestError((e as Error).message, { cause: e })
}

export const GlobalRequest = global.Request
export class Request extends GlobalRequest {
  constructor(input: string | Request, options?: RequestInit) {
    if (typeof input === 'object' && getRequestCache in input) {
      input = (input as any)[getRequestCache]()
    }
    // Check if body is ReadableStream like. This makes it compatbile with ReadableStream polyfills.
    if (typeof (options?.body as ReadableStream)?.getReader !== 'undefined') {
      // node 18 fetch needs half duplex mode when request body is stream
      // if already set, do nothing since a Request object was passed to the options or explicitly set by the user.
      ;(options as any).duplex ??= 'half'
    }
    super(input, options)
  }
}

const newRequestFromIncoming = (
  method: string,
  url: string,
  incoming: IncomingMessage | Http2ServerRequest,
  abortController: AbortController
): Request => {
  const headerRecord: [string, string][] = []
  const rawHeaders = incoming.rawHeaders
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const { [i]: key, [i + 1]: value } = rawHeaders
    if (key.charCodeAt(0) !== /*:*/ 0x3a) {
      headerRecord.push([key, value])
    }
  }

  const init = {
    method: method,
    headers: headerRecord,
    signal: abortController.signal,
  } as RequestInit

  if (method === 'TRACE') {
    init.method = 'GET'
    const req = new Request(url, init)
    Object.defineProperty(req, 'method', {
      get() {
        return 'TRACE'
      },
    })
    return req
  }

  if (!(method === 'GET' || method === 'HEAD')) {
    if ('rawBody' in incoming && incoming.rawBody instanceof Buffer) {
      // In some environments (e.g. firebase functions), the body is already consumed.
      // So we need to re-read the request body from `incoming.rawBody` if available.
      init.body = new ReadableStream({
        start(controller) {
          controller.enqueue(incoming.rawBody)
          controller.close()
        },
      })
    } else {
      // lazy-consume request body
      init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
    }
  }

  return new Request(url, init)
}

const getRequestCache = Symbol('getRequestCache')
const requestCache = Symbol('requestCache')
const incomingKey = Symbol('incomingKey')
const urlKey = Symbol('urlKey')
export const abortControllerKey = Symbol('abortControllerKey')
export const getAbortController = Symbol('getAbortController')

const requestPrototype: Record<string | symbol, any> = {
  get method() {
    return this[incomingKey].method || 'GET'
  },

  get url() {
    return this[urlKey]
  },

  [getAbortController]() {
    this[getRequestCache]()
    return this[abortControllerKey]
  },

  [getRequestCache]() {
    this[abortControllerKey] ||= new AbortController()
    return (this[requestCache] ||= newRequestFromIncoming(
      this.method,
      this[urlKey],
      this[incomingKey],
      this[abortControllerKey]
    ))
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
  'keepalive',
].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    get() {
      return this[getRequestCache]()[k]
    },
  })
})
;['arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text'].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    value: function () {
      return this[getRequestCache]()[k]()
    },
  })
})
Object.setPrototypeOf(requestPrototype, Request.prototype)

export const newRequest = (
  incoming: IncomingMessage | Http2ServerRequest,
  defaultHostname?: string
) => {
  const req = Object.create(requestPrototype)
  req[incomingKey] = incoming

  const host =
    (incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host) ||
    defaultHostname
  if (!host) {
    throw new RequestError('Missing host header')
  }
  const url = new URL(
    `${
      incoming instanceof Http2ServerRequest ||
      (incoming.socket && (incoming.socket as TLSSocket).encrypted)
        ? 'https'
        : 'http'
    }://${host}${incoming.url}`
  )

  // check by length for performance.
  // if suspicious, check by host. host header sometimes contains port.
  if (url.hostname.length !== host.length && url.hostname !== host.replace(/:\d+$/, '')) {
    throw new RequestError('Invalid host header')
  }

  req[urlKey] = url.href

  return req
}
