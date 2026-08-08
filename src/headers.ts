import type { IncomingMessage } from 'node:http'
import { Http2ServerRequest } from 'node:http2'

type IncomingHeadersSource = Pick<IncomingMessage | Http2ServerRequest, 'rawHeaders'> & {
  headers?: IncomingMessage['headers']
}

// Node's HTTP/1 parser already joins ordinary repeated headers with the same
// separators as WHATWG Headers, so its parsed object is a safe fast path for
// those names. It discards repeats of this fixed set by default, however, and
// HTTP/2 has different collapsing rules; resolve those cases from rawHeaders.
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

const isHttpWhitespace = (code: number): boolean =>
  code === 0x09 || code === 0x0a || code === 0x0d || code === 0x20

const normalizeHeaderValue = (value: string): string => {
  if (
    !isHttpWhitespace(value.charCodeAt(0)) &&
    !isHttpWhitespace(value.charCodeAt(value.length - 1))
  ) {
    return value
  }
  let start = 0
  let end = value.length
  while (start < end && isHttpWhitespace(value.charCodeAt(start))) {
    start++
  }
  while (end > start && isHttpWhitespace(value.charCodeAt(end - 1))) {
    end--
  }
  return value.slice(start, end)
}

const forbiddenHeaderValue = /[\0\r\n]/

export const GlobalHeaders = globalThis.Headers
export type GlobalHeaders = InstanceType<typeof GlobalHeaders>

const materializeHeaders = (
  rawHeaders: string[],
  HeadersCtor: typeof GlobalHeaders = GlobalHeaders
): GlobalHeaders => {
  const headers = new HeadersCtor()
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
  #rawHeaders?: string[]
  #headers?: GlobalHeaders
  #invalidValue?: boolean

  constructor(incoming: IncomingHeadersSource) {
    this.#incoming = incoming
    if (incoming instanceof Http2ServerRequest) {
      this.#rawHeaders = incoming.rawHeaders.slice()
    }
  }

  get #lazyRawHeaders(): string[] {
    return (this.#rawHeaders ??= this.#incoming.rawHeaders.slice())
  }

  get #native(): GlobalHeaders {
    if (!this.#headers) {
      this.#headers = materializeHeaders(this.#lazyRawHeaders)
      this.#rawHeaders = undefined
    }
    return this.#headers
  }

  #normalizedName(name: string): string | undefined {
    if (typeof name !== 'string') {
      return
    }
    if (!validHeaderName.test(name)) {
      throw new TypeError(`Invalid header name: ${name}`)
    }
    return name.toLowerCase()
  }

  // The HTTP/1 fast path trusts Node's parser-produced headers object. Mutating
  // it through the incoming binding is outside this optimization's contract;
  // detecting such changes would require scanning or copying every header.
  #lookupHttp1(lowerName: string): string | null | undefined {
    const headers =
      this.#incoming instanceof Http2ServerRequest ? undefined : this.#incoming.headers
    if (
      !headers ||
      nonJoinedHeaders.has(lowerName) ||
      lowerName === 'set-cookie' ||
      lowerName === '__proto__'
    ) {
      return
    }

    if (!Object.hasOwn(headers, lowerName)) {
      return null
    }
    const rawValue = headers[lowerName]
    if (typeof rawValue === 'string') {
      const value = normalizeHeaderValue(rawValue)
      return forbiddenHeaderValue.test(value) ? undefined : value
    }
    return
  }

  #lookup(rawHeaders: string[], lowerName: string): string | null | undefined {
    const separator = lowerName === 'cookie' ? '; ' : ', '
    let value: string | null = null
    for (let i = 0; i < rawHeaders.length; i += 2) {
      const rawName = rawHeaders[i]
      if (rawName.length === lowerName.length && rawName.toLowerCase() === lowerName) {
        const rawValue = normalizeHeaderValue(rawHeaders[i + 1])
        if (forbiddenHeaderValue.test(rawValue)) {
          this.#invalidValue = true
          return
        }
        value = value === null ? rawValue : value + separator + rawValue
      }
    }

    return value
  }

  append(name: string, value: string): void {
    this.#native.append(name, value)
  }

  delete(name: string): void {
    this.#native.delete(name)
  }

  get(name: string): string | null {
    const lowerName = this.#normalizedName(name)
    if (lowerName && !this.#headers && !this.#invalidValue) {
      const http1Value = this.#lookupHttp1(lowerName)
      if (http1Value !== undefined) {
        return http1Value
      }
      const value = this.#lookup(this.#lazyRawHeaders, lowerName)
      if (value !== undefined) {
        return value
      }
    }
    return this.#native.get(name)
  }

  has(name: string): boolean {
    const lowerName = this.#normalizedName(name)
    if (lowerName && !this.#headers && !this.#invalidValue) {
      const http1Value = this.#lookupHttp1(lowerName)
      if (http1Value !== undefined) {
        return http1Value !== null
      }
      const value = this.#lookup(this.#lazyRawHeaders, lowerName)
      if (value !== undefined) {
        return value !== null
      }
    }
    return this.#native.has(name)
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

// Keep request headers compatible with the captured Headers constructor so
// `request.headers instanceof Headers` remains true without Symbol.hasInstance
// or replacing the global constructor.
Object.setPrototypeOf(RequestHeaders.prototype, GlobalHeaders.prototype)

// Preserve the previous live-global behavior when a consumer installs a
// Headers polyfill after this module has initialized.
export const newHeadersFromIncoming = (incoming: IncomingHeadersSource): GlobalHeaders =>
  globalThis.Headers === GlobalHeaders
    ? (new RequestHeaders(incoming) as unknown as GlobalHeaders)
    : materializeHeaders(incoming.rawHeaders, globalThis.Headers)
