/* eslint-disable @typescript-eslint/no-explicit-any */
// Define lightweight pseudo Response class and replace global.Response with it.

import type { OutgoingHttpHeaders } from 'node:http'
import { types } from 'node:util'

export const defaultContentType = 'text/plain; charset=UTF-8'

const responseCache = Symbol('responseCache')
const getResponseCache = Symbol('getResponseCache')
export const cacheKey = Symbol('cache')
export const copyHeaders = Symbol.for('hono.response.copyHeaders')

export type InternalCache = [
  number,
  string | ReadableStream | null,
  Record<string, string> | [string, string][] | Headers | OutgoingHttpHeaders | undefined,
]
interface LightResponse {
  [responseCache]?: globalThis.Response
  [cacheKey]?: InternalCache
}

interface SharedBody {
  body: string | null
  members: Response[]
  sent: boolean
  materialized: boolean
}

const materializeSharedBody = (group: SharedBody): void => {
  if (group.materialized) {
    return
  }
  group.materialized = true
  let first: globalThis.Response | undefined
  for (const member of group.members) {
    const cached = member as LightResponse
    const [status, , headers] = cached[cacheKey]!
    const native = new GlobalResponse(first ? first.body : group.body, {
      status,
      headers: headers as Headers,
    })
    first ||= native
    cached[responseCache] = native
    delete cached[cacheKey]
  }
  if (group.sent && first?.body) {
    const reader = first.body.getReader()
    void reader.read()
    void reader.read()
  }
}

// A second send must observe the same consumed stream as a materialized response.
export const consumeSharedBody = (response: globalThis.Response): boolean => {
  const group = Response.sharedBodyFor(response)
  if (group?.sent) {
    materializeSharedBody(group)
    return false
  }
  if (group && !group.materialized) {
    group.sent = true
  }
  return true
}

export const GlobalResponse = global.Response
export class Response {
  #body?: BodyInit | null
  #init?: ResponseInit
  #sharedBody?: SharedBody

  static sharedBodyFor(response: object): SharedBody | undefined {
    return #sharedBody in response ? response.#sharedBody : undefined
  }

  static [copyHeaders](response: globalThis.Response): globalThis.Response | undefined {
    if (
      types.isProxy(response) ||
      Object.getPrototypeOf(response) !== Response.prototype ||
      Object.getOwnPropertyNames(response).length !== 0
    ) {
      return
    }
    const original = response as unknown as Response
    if (!(#sharedBody in original)) {
      return
    }
    const cache = (original as LightResponse)[cacheKey]
    if (
      !cache ||
      (original as LightResponse)[responseCache] ||
      !(cache[1] === null || typeof cache[1] === 'string')
    ) {
      return
    }
    let group = original.#sharedBody
    if (group?.sent || (group && group.members.length >= 64)) {
      return
    }
    const init = original.#init
    if (
      !group &&
      init &&
      (types.isProxy(init) ||
        Object.getPrototypeOf(init) !== Object.prototype ||
        Reflect.ownKeys(init).some(
          (key) =>
            !['status', 'headers', 'statusText'].includes(key as string) ||
            !Object.hasOwn(Object.getOwnPropertyDescriptor(init, key)!, 'value')
        ))
    ) {
      return
    }
    const status = group ? cache[0] : (init?.status ?? 200)
    if (
      !group &&
      (!Number.isInteger(status) ||
        status < 200 ||
        status > 599 ||
        status !== cache[0] ||
        (init?.statusText !== undefined && init.statusText !== '') ||
        (cache[1] !== null && [204, 205, 304].includes(status)))
    ) {
      return
    }
    if (!group) {
      const headers = new Headers(cache[2] instanceof Headers ? cache[2] : init?.headers)
      if (cache[1] !== null && !headers.has('content-type')) {
        headers.set('content-type', 'text/plain;charset=UTF-8')
      }
      cache[2] = headers
      group = { body: cache[1], members: [original], sent: false, materialized: false }
      original.#sharedBody = group
    }
    const replacement = new Response(cache[1], {
      status,
      headers: new Headers(cache[2] as Headers),
    })
    group.members.push(replacement)
    replacement.#sharedBody = group
    return replacement as unknown as globalThis.Response
  }

  [getResponseCache](): globalThis.Response {
    if (this.#sharedBody) {
      materializeSharedBody(this.#sharedBody)
      return (this as LightResponse)[responseCache]!
    }
    // If `cacheKey` has been populated with a live `Headers` instance, the
    // user (or middleware) may have mutated it after construction. Use those
    // headers so the GlobalResponse reflects the current state.
    const cache = (this as LightResponse)[cacheKey]
    const liveHeaders = cache && cache[2] instanceof Headers ? cache[2] : undefined
    delete (this as LightResponse)[cacheKey]
    return ((this as LightResponse)[responseCache] ||= new GlobalResponse(
      this.#body,
      liveHeaders
        ? {
            status: this.#init?.status,
            statusText: this.#init?.statusText,
            headers: liveHeaders,
          }
        : this.#init
    ))
  }

  constructor(body?: BodyInit | null, init?: ResponseInit) {
    let headers: HeadersInit | undefined
    this.#body = body
    if (init instanceof GlobalResponse) {
      const cachedGlobalResponse = (init as any)[responseCache]
      if (cachedGlobalResponse) {
        this.#init = cachedGlobalResponse
        // instantiate GlobalResponse cache and this object always returns value from global.Response
        this[getResponseCache]()
        return
      }
      this.#init = init instanceof Response ? init.#init : init
      headers = new Headers(init.headers)
    } else {
      this.#init = init
    }

    if (
      body == null ||
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
          (cache[2] ||
            (cache[1] === null ? undefined : { 'content-type': defaultContentType })) as HeadersInit
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

// Fast path regex: matches http:// or https:// followed by RFC 3986 allowed chars.
// Character class covers unreserved + reserved chars plus `%` for percent-encoding.
// !  #-;  =  ?-[  ]  _  a-z  ~  A-Z (A-Z is within ?-[ range but listed for clarity)
const validRedirectUrl = /^https?:\/\/[!#-;=?-[\]_a-z~A-Z]+$/
const parseRedirectUrl = (url: string | URL): string => {
  if (url instanceof URL) {
    return url.href
  }
  if (validRedirectUrl.test(url)) {
    return url
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
