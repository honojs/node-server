// Define prototype for lightweight pseudo Request object

import { Readable } from 'node:stream'
import type { IncomingMessage } from 'node:http'
import type { Http2ServerRequest } from 'node:http2'

const newRequestFromIncoming = (
  method: string,
  url: string,
  incoming: IncomingMessage | Http2ServerRequest
): Request => {
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

const getRequestCache = Symbol('getRequestCache')
const requestCache = Symbol('requestCache')

export const requestPrototype: Record<string | symbol, any> = {
  [getRequestCache]() {
    return (this[requestCache] ||= newRequestFromIncoming(this.method, this.url, this.incoming))
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
