/* eslint-disable @typescript-eslint/no-explicit-any */
// Define lightweight pseudo Response class and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'

interface InternalBody {
  source: string | Uint8Array | FormData | Blob | null
  stream: ReadableStream
  length: number | null
}

const responseCache = Symbol('responseCache')
const getResponseCache = Symbol('getResponseCache')
export const cacheKey = Symbol('cache')

export type InternalCache = [
  number,
  string | ReadableStream,
  Record<string, string> | Headers | OutgoingHttpHeaders,
]
interface LiteResponse {
  [responseCache]?: globalThis.Response
  [cacheKey]?: InternalCache
}

export const GlobalResponse = global.Response
export class Response {
  #body?: BodyInit | null
  #init?: ResponseInit;

  [getResponseCache](): globalThis.Response {
    delete (this as LiteResponse)[cacheKey]
    return ((this as LiteResponse)[responseCache] ||= new GlobalResponse(this.#body, this.#init))
  }

  constructor(body?: BodyInit | null, init?: ResponseInit) {
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
      }
    } else {
      this.#init = init
    }

    if (typeof body === 'string' || typeof (body as ReadableStream)?.getReader !== 'undefined') {
      const headers = (init?.headers || { 'content-type': 'text/plain; charset=UTF-8' }) as
        | Record<string, string>
        | Headers
        | OutgoingHttpHeaders
      ;(this as any)[cacheKey] = [init?.status || 200, body, headers]
    }
  }

  get headers(): Headers {
    const cache = (this as LiteResponse)[cacheKey] as InternalCache
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
      ((this as LiteResponse)[cacheKey] as InternalCache | undefined)?.[0] ??
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

const stateKey = Reflect.ownKeys(new GlobalResponse()).find(
  (k) => typeof k === 'symbol' && k.toString() === 'Symbol(state)'
) as symbol | undefined
if (!stateKey) {
  console.warn('Failed to find Response internal state key')
}

export function getInternalBody(
  response: Response | globalThis.Response
): InternalBody | undefined {
  if (!stateKey) {
    return
  }

  if (response instanceof Response) {
    response = (response as any)[getResponseCache]()
  }

  const state = (response as any)[stateKey] as { body?: InternalBody } | undefined

  return (state && state.body) || undefined
}
