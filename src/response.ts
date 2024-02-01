/* eslint-disable @typescript-eslint/no-explicit-any */
// Define lightweight pseudo Response class and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'
import { buildOutgoingHttpHeaders } from './utils'

const responseCache = Symbol('responseCache')
export const cacheKey = Symbol('cache')

export const GlobalResponse = global.Response
export class Response {
  #body?: BodyInit | null
  #init?: ResponseInit

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    this.#body = body

    if (init instanceof Response) {
      this.handleResponseInitFromAnotherResponse(init)
    } else {
      this.#init = init
    }

    this.handleBodyStringOrStream(body, init)
  }

  private get cache(): typeof GlobalResponse {
    delete (this as any)[cacheKey]
    return ((this as any)[responseCache] ||= new GlobalResponse(this.#body, this.#init))
  }

  private handleResponseInitFromAnotherResponse(init: Response): void {
    const cachedGlobalResponse = (init as any)[responseCache]

    if (cachedGlobalResponse) {
      this.#init = cachedGlobalResponse
      this.cache
    } else {
      this.#init = init.#init
    }
  }

  private handleBodyStringOrStream(body?: BodyInit | null, init?: ResponseInit): void {
    const headers = this.buildHeaders(init?.headers)

    if (typeof body === 'string' || body instanceof ReadableStream) {
      ;(this as any)[cacheKey] = [init?.status || 200, body, headers]
    }
  }

  private buildHeaders(headers?: HeadersInit): HeadersInit | OutgoingHttpHeaders {
    if (headers instanceof Headers) {
      return buildOutgoingHttpHeaders(headers)
    }

    return headers || { 'content-type': 'text/plain;charset=UTF-8' }
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
Object.setPrototypeOf(Response, GlobalResponse)
Object.setPrototypeOf(Response.prototype, GlobalResponse.prototype)
Object.defineProperty(global, 'Response', {
  value: Response,
})
