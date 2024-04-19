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
    if (options?.body instanceof ReadableStream) {
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

  if (!(method === 'GET' || method === 'HEAD')) {
    // lazy-consume request body
    init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
  }

  return new Request(url, init)
}

const getRequestCache = Symbol('getRequestCache')
const requestCache = Symbol('requestCache')
const incomingKey = Symbol('incomingKey')
const urlKey = Symbol('urlKey')
const abortControllerKey = Symbol('abortControllerKey')
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

export const newRequest = (incoming: IncomingMessage | Http2ServerRequest) => {
  const req = Object.create(requestPrototype)
  req[incomingKey] = incoming
  req[urlKey] = new URL(
    `${
      incoming instanceof Http2ServerRequest ||
      (incoming.socket && (incoming.socket as TLSSocket).encrypted)
        ? 'https'
        : 'http'
    }://${incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host}${
      incoming.url
    }`
  ).href
  return req
}
