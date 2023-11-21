// Define lightweight pseudo Response class and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'
import { buildOutgoingHttpHeaders } from './utils'

export const globalResponse = global.Response
class Response {
  getResponseCache() {
    delete (this as any).__cache
    return ((this as any).responseCache ||= new globalResponse(
      (this as any).__body,
      (this as any).__init
    ))
  }

  constructor(body: BodyInit | null, init?: ResponseInit) {
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

      ;(this as any).__cache = [init?.status || 200, body, headers]
    }
  }
}
;[
  'body',
  'bodyUsed',
  'headers',
  'ok',
  'redirected',
  'status',
  'statusText',
  'trailers',
  'type',
  'url',
].forEach((k) => {
  Object.defineProperty(Response.prototype, k, {
    get() {
      return this.getResponseCache()[k]
    },
  })
})
;['arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text'].forEach((k) => {
  Object.defineProperty(Response.prototype, k, {
    value: function () {
      return this.getResponseCache()[k]()
    },
  })
})
Object.setPrototypeOf(Response, globalResponse)
Object.setPrototypeOf(Response.prototype, globalResponse.prototype)
Object.defineProperty(global, 'Response', {
  value: Response,
})
