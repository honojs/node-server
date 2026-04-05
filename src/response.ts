/* eslint-disable @typescript-eslint/no-explicit-any */
// Define lightweight pseudo Response class and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'

const responseCache = Symbol('responseCache')
const getResponseCache = Symbol('getResponseCache')
export const cacheKey = Symbol('cache')

export type InternalCache = [
  number,
  string | ReadableStream | null,
  Record<string, string> | [string, string][] | Headers | OutgoingHttpHeaders | undefined,
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
    let headers: HeadersInit | undefined
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
      body === null ||
      body === undefined ||
      typeof body === 'string' ||
      typeof (body as ReadableStream)?.getReader !== 'undefined' ||
      body instanceof Blob ||
      body instanceof Uint8Array
    ) {
      ;(this as any)[cacheKey] = [init?.status || 200, body ?? null, headers || init?.headers]
    }
  }

  get headers(): Headers {
    const cache = (this as LightResponse)[cacheKey] as InternalCache
    if (cache) {
      if (!(cache[2] instanceof Headers)) {
        cache[2] = new Headers(
          (cache[2] || { 'content-type': 'text/plain; charset=UTF-8' }) as HeadersInit
        )
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

Object.defineProperty(Response.prototype, Symbol.for('nodejs.util.inspect.custom'), {
  value: function (depth: number, options: object, inspectFn: Function) {
    const props: Record<string, unknown> = {
      status: this.status,
      headers: this.headers,
      ok: this.ok,
      nativeResponse: (this as LightResponse)[responseCache],
    }
    return `Response (lightweight) ${inspectFn(props, { ...options, depth: depth == null ? null : depth - 1 })}`
  },
})

Object.setPrototypeOf(Response, GlobalResponse)
Object.setPrototypeOf(Response.prototype, GlobalResponse.prototype)

// Allowed characters in a redirect URL (ASCII subset).
// Covers unreserved + reserved chars per RFC 3986 plus `%` for percent-encoding.
const allowedRedirectUrlChar = new Uint8Array(128)
for (let c = 0x30; c <= 0x39; c++) {
  allowedRedirectUrlChar[c] = 1 // 0-9
}
for (let c = 0x41; c <= 0x5a; c++) {
  allowedRedirectUrlChar[c] = 1 // A-Z
}
for (let c = 0x61; c <= 0x7a; c++) {
  allowedRedirectUrlChar[c] = 1 // a-z
}
{
  // eslint-disable-next-line quotes
  const chars = "-./:?#[]@!$&'()*+,;=%~_"
  for (let i = 0; i < chars.length; i++) {
    allowedRedirectUrlChar[chars.charCodeAt(i)] = 1
  }
}

const parseRedirectUrl = (url: string | URL): string => {
  if (url instanceof URL) {
    return url.href
  }
  // Fast path: starts with http:// or https:// and all chars are in the allowed set
  if (
    url.length > 8 &&
    url.charCodeAt(0) === 0x68 && // h
    (url.charCodeAt(4) === 0x3a || url.charCodeAt(5) === 0x3a) // http: or https:
  ) {
    let safe = true
    for (let i = 0, len = url.length; i < len; i++) {
      const c = url.charCodeAt(i)
      if (c > 0x7f || allowedRedirectUrlChar[c] === 0) {
        safe = false
        break
      }
    }
    if (safe) {
      return url
    }
  }
  return new URL(url).href
}

const validRedirectStatuses = new Set([301, 302, 303, 307, 308])

// Override Response.json() and Response.redirect() to return a LightweightResponse
// so the listener fast-path (cacheKey check) is hit instead of falling through to ReadableStream reading.
Object.defineProperty(Response, 'redirect', {
  value: function redirect(url: string | URL, status = 302): Response {
    if (!validRedirectStatuses.has(status)) {
      throw new RangeError('Invalid status code')
    }
    return new Response(null, {
      status,
      headers: { location: parseRedirectUrl(url) },
    })
  },
  writable: true,
  configurable: true,
})

Object.defineProperty(Response, 'json', {
  value: function json(data?: unknown, init?: ResponseInit): Response {
    const body = JSON.stringify(data)
    if (body === undefined) {
      throw new TypeError('The data is not JSON serializable')
    }
    const initHeaders = init?.headers
    let headers: Record<string, string> | Headers
    if (initHeaders) {
      headers = new Headers(initHeaders)
      if (!headers.has('content-type')) {
        headers.set('content-type', 'application/json')
      }
    } else {
      headers = { 'content-type': 'application/json' }
    }
    return new Response(body, {
      status: init?.status ?? 200,
      statusText: init?.statusText,
      headers,
    })
  },
  writable: true,
  configurable: true,
})
