/* eslint-disable @typescript-eslint/no-explicit-any */
// Define prototype for lightweight pseudo Request object

import type { IncomingMessage } from 'node:http'
import { Http2ServerRequest } from 'node:http2'
import { Readable } from 'node:stream'

const newRequestFromIncoming = (
  method: string,
  url: string,
  incoming: IncomingMessage | Http2ServerRequest
): Request => {
  const headerRecord: [string, string][] = []
  const rawHeaders = incoming.rawHeaders
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const {[i]: key, [i + 1]: value} = rawHeaders
    if (key.charCodeAt(0) !== /*:*/ 0x3a) {
      headerRecord.push([key, value])
    }
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

const getRequestCache = Symbol('getRequestCache')
const requestCache = Symbol('requestCache')
const incomingKey = Symbol('incomingKey')

const requestPrototype: Record<string | symbol, any> = {
  get method() {
    return this[incomingKey].method || 'GET'
  },

  get url() {
    if (this[requestCache]) return this[requestCache].url
    const req = this[incomingKey]
    const url = `http://${req instanceof Http2ServerRequest ? req.authority : req.headers.host}${req.url}`
    return new URL(url).href
  },

  [getRequestCache]() {
    return (this[requestCache] ||= newRequestFromIncoming(this.method, this.url, this[incomingKey]))
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
Object.setPrototypeOf(requestPrototype, global.Request.prototype)

export const newRequest = (incoming: IncomingMessage | Http2ServerRequest) => {
  const req = Object.create(requestPrototype)
  req[incomingKey] = incoming
  return req
}
