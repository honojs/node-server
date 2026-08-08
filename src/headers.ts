import type { IncomingMessage } from 'node:http'
import type { Http2ServerRequest } from 'node:http2'

type IncomingHeadersSource = Pick<IncomingMessage | Http2ServerRequest, 'rawHeaders'> & {
  headers?: Record<string, string | string[] | undefined>
}

// Node keeps only the first occurrence of these headers in `incoming.headers`,
// while WHATWG Headers combines repeated values. Fall back to rawHeaders when
// one of them is actually repeated.
// https://nodejs.org/api/http.html#messageheaders
// https://github.com/nodejs/node/blob/v26.7.0/lib/_http_incoming.js
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.2
const nonJoinedHeaders = new Set([
  'age',
  'authorization',
  'content-length',
  'content-type',
  'etag',
  'expires',
  'from',
  'host',
  'if-modified-since',
  'if-unmodified-since',
  'last-modified',
  'location',
  'max-forwards',
  'proxy-authorization',
  'referer',
  'retry-after',
  'server',
  'user-agent',
])

// Converted from RFC 9110's `field-name = token` and `token`/`tchar` ABNF.
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.1
// https://www.rfc-editor.org/rfc/rfc9110.html#section-5.6.2
const validHeaderName = /^[!#$%&'*+\-.^_`|~\dA-Za-z]+$/

export const GlobalHeaders = globalThis.Headers
export type GlobalHeaders = InstanceType<typeof GlobalHeaders>

const materializeHeaders = (
  incoming: Pick<IncomingMessage | Http2ServerRequest, 'rawHeaders'>
): GlobalHeaders => {
  const headers = new GlobalHeaders()
  const rawHeaders = incoming.rawHeaders
  for (let i = 0; i < rawHeaders.length; i += 2) {
    const name = rawHeaders[i]
    if (!name.startsWith(':')) {
      headers.append(name, rawHeaders[i + 1])
    }
  }
  return headers
}

export class RequestHeaders {
  #incoming: IncomingHeadersSource
  #headers?: GlobalHeaders

  constructor(incoming: IncomingHeadersSource) {
    this.#incoming = incoming
  }

  get #native(): GlobalHeaders {
    if (!this.#headers) {
      this.#headers = materializeHeaders(this.#incoming)
    }
    return this.#headers
  }

  #normalizedName(name: string): string | undefined {
    if (typeof name !== 'string') {
      return
    }
    const lowerName = name.toLowerCase()
    return validHeaderName.test(name) && lowerName !== '__proto__' ? lowerName : undefined
  }

  append(name: string, value: string): void {
    this.#native.append(name, value)
  }

  delete(name: string): void {
    this.#native.delete(name)
  }

  get(name: string): string | null {
    if (this.#headers) {
      return this.#native.get(name)
    }

    const lowerName = this.#normalizedName(name)
    if (!lowerName) {
      return this.#native.get(name)
    }

    const value = this.#incoming.headers?.[lowerName]
    if (typeof value === 'string') {
      if (nonJoinedHeaders.has(lowerName)) {
        let found = false
        for (let i = 0; i < this.#incoming.rawHeaders.length; i += 2) {
          const rawName = this.#incoming.rawHeaders[i]
          if (rawName.length === lowerName.length && rawName.toLowerCase() === lowerName) {
            if (found) {
              return this.#native.get(name)
            }
            found = true
          }
        }
      }
      return value
    }
    if (Array.isArray(value)) {
      return value.join(', ')
    }
    return this.#incoming.headers ? null : this.#native.get(name)
  }

  has(name: string): boolean {
    if (this.#headers) {
      return this.#native.has(name)
    }

    const lowerName = this.#normalizedName(name)
    if (!lowerName) {
      return this.#native.has(name)
    }
    return this.#incoming.headers
      ? Object.hasOwn(this.#incoming.headers, lowerName)
      : this.#native.has(name)
  }

  set(name: string, value: string): void {
    this.#native.set(name, value)
  }

  getSetCookie(): string[] {
    return this.#native.getSetCookie()
  }

  keys(): HeadersIterator<string> {
    return this.#native.keys()
  }

  values(): HeadersIterator<string> {
    return this.#native.values()
  }

  entries(): HeadersIterator<[string, string]> {
    return this.#native.entries()
  }

  forEach(
    callback: (value: string, key: string, parent: GlobalHeaders) => void,
    thisArg?: unknown
  ): void {
    this.#native.forEach((value, key) => {
      callback.call(thisArg, value, key, this as unknown as GlobalHeaders)
    })
  }

  [Symbol.iterator](): HeadersIterator<[string, string]> {
    return this.entries()
  }
}

Object.defineProperty(RequestHeaders.prototype, Symbol.for('nodejs.util.inspect.custom'), {
  value: function (this: RequestHeaders, depth: number, options: object, inspectFn: Function) {
    const props = Object.fromEntries(this)
    return `Headers (lightweight) ${inspectFn(props, { ...options, depth: depth == null ? null : depth - 1 })}`
  },
})

// Keep request headers compatible with the global Headers constructor without
// replacing it for application-created and response headers.
Object.setPrototypeOf(RequestHeaders.prototype, GlobalHeaders.prototype)

export const newHeadersFromIncoming = (incoming: IncomingHeadersSource): GlobalHeaders =>
  new RequestHeaders(incoming) as unknown as GlobalHeaders
