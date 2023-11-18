// Define lightweight pseudo Response object and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'
import { buildOutgoingHttpHeaders } from './utils'

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
    let headers = (init?.headers || { 'content-type': 'text/plain;charset=UTF-8' }) as
      | Record<string, string>
      | Headers
      | OutgoingHttpHeaders
    if (headers instanceof Headers) {
      headers = buildOutgoingHttpHeaders(headers)
    }

    ;(this as any).__cache = [body, headers]
  }
}
newResponse.prototype = responsePrototype
Object.defineProperty(global, 'Response', {
  value: newResponse,
})
