/* eslint-disable @typescript-eslint/no-explicit-any */
// Define lightweight pseudo Response class and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'

const responseCache = Symbol('responseCache')
const getResponseCache = Symbol('getResponseCache')
export const cacheKey = Symbol('cache')

export type InternalCache = [
  number,
  string | ReadableStream,
  Record<string, string> | Headers | OutgoingHttpHeaders,
]
interface LightResponse {
  [responseCache]?: globalThis.Response
  [cacheKey]?: InternalCache
}

export const GlobalResponse = global.Response
export class Response {
  #body?: BodyInit | null
  #init?: ResponseInit;

  [getResponseCache](): globalThis.Response {
    delete (this as LightResponse)[cacheKey]
    return ((this as LightResponse)[responseCache] ||= new GlobalResponse(this.#body, this.#init))
  }

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    let headers: HeadersInit
    this.#body = body
    if (init instanceof Response) {
      const cachedGlobalResponse = (init as any)[responseCache]
      if (cachedGlobalResponse) {
        this.#init = cachedGlobalResponse
        // instantiate GlobalResponse cache and this object always returns value from global.Response
        this[getResponseCache]()
        return
      } else {
        this.#init = init.#init
        // clone headers to avoid sharing the same object between parent and child
        headers = new Headers((init.#init as ResponseInit).headers)
      }
    } else {
      this.#init = init
    }

    if (
      typeof body === 'string' ||
      typeof (body as ReadableStream)?.getReader !== 'undefined' ||
      body instanceof Blob ||
      body instanceof Uint8Array
    ) {
      headers ||= init?.headers || { 'content-type': 'text/plain; charset=UTF-8' }
      ;(this as any)[cacheKey] = [init?.status || 200, body, headers]
    }
  }

  get headers(): Headers {
    const cache = (this as LightResponse)[cacheKey] as InternalCache
    if (cache) {
      if (!(cache[2] instanceof Headers)) {
        cache[2] = new Headers(cache[2] as HeadersInit)
      }
      return cache[2]
    }
    return this[getResponseCache]().headers
  }

  get status() {
    return (
      ((this as LightResponse)[cacheKey] as InternalCache | undefined)?.[0] ??
      this[getResponseCache]().status
    )
  }

  get ok() {
    const status = this.status
    return status >= 200 && status < 300
  }
}
;['body', 'bodyUsed', 'redirected', 'statusText', 'trailers', 'type', 'url'].forEach((k) => {
  Object.defineProperty(Response.prototype, k, {
    get() {
      return this[getResponseCache]()[k]
    },
  })
})
;['arrayBuffer', 'blob', 'clone', 'formData', 'json', 'text'].forEach((k) => {
  Object.defineProperty(Response.prototype, k, {
    value: function () {
      return this[getResponseCache]()[k]()
    },
  })
})
Object.setPrototypeOf(Response, GlobalResponse)
Object.setPrototypeOf(Response.prototype, GlobalResponse.prototype)
