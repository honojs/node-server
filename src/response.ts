// Define lightweight pseudo Response class and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'
import { buildOutgoingHttpHeaders } from './utils'

const responseCache = Symbol('responseCache')
export const cacheKey = Symbol('cache')

export const globalResponse = global.Response
export class Response {
  #body?: BodyInit | null
  #init?: ResponseInit;

  // @ts-ignore
  private get cache(): typeof globalResponse {
    delete (this as any)[cacheKey]
    return ((this as any)[responseCache] ||= new globalResponse(this.#body, this.#init))
  }

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.#body = body
    this.#init = init

    if (typeof body === 'string' || body instanceof ReadableStream) {
      let headers = (init?.headers || { 'content-type': 'text/plain;charset=UTF-8' }) as
        | Record<string, string>
        | Headers
        | OutgoingHttpHeaders
      if (headers instanceof Headers) {
        headers = buildOutgoingHttpHeaders(headers)
      }

      (this as any)[cacheKey] = [init?.status || 200, body, headers]
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
      return this.cache[k]
    },
  })
})
;['arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text'].forEach((k) => {
  Object.defineProperty(Response.prototype, k, {
    value: function () {
      return this.cache[k]()
    },
  })
})
Object.setPrototypeOf(Response, globalResponse)
Object.setPrototypeOf(Response.prototype, globalResponse.prototype)
Object.defineProperty(global, 'Response', {
  value: Response,
})
