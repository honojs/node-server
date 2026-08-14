import type { IncomingMessage } from 'node:http'
import { Http2ServerRequest } from 'node:http2'
import type { ServerHttp2Stream } from 'node:http2'
import { Duplex } from 'node:stream'
import { inspect } from 'node:util'
import { GlobalHeaders, RequestHeaders, newHeadersFromIncoming } from '../src/headers'
import { newRequest, Request as LightweightRequest } from '../src/request'

// Compatibility cases adapted from srvx's Node header suite:
// https://github.com/h3js/srvx/blob/4052594e76d5ead2cc4c7cf8f7fa6d5ea9558a0a/test/node-headers.test.ts

const incoming = (rawHeaders: string[], headers: Record<string, unknown>): IncomingMessage =>
  ({ rawHeaders, headers }) as IncomingMessage

const incomingHttp2 = (
  rawHeaders: string[],
  headers: Record<string, string | string[]>
): Http2ServerRequest =>
  new Http2ServerRequest(new Duplex() as ServerHttp2Stream, headers, {}, rawHeaders)

const lightweightHeaders = (request: IncomingMessage | Http2ServerRequest): GlobalHeaders =>
  newHeadersFromIncoming(request)

const nonJoinedHeaderNames = [
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
]

describe('RequestHeaders', () => {
  it('reads common headers without iterating rawHeaders', () => {
    let rawHeadersReads = 0
    const request = {
      headers: { 'x-test': 'value' },
      get rawHeaders() {
        rawHeadersReads++
        return ['x-test', 'value']
      },
    } as unknown as IncomingMessage

    const headers = lightweightHeaders(request)

    expect(headers).toBeInstanceOf(GlobalHeaders)
    expect(headers.get('X-Test')).toBe('value')
    expect(headers.has('x-test')).toBe(true)
    expect(rawHeadersReads).toBe(0)
    expect(() => headers.get('bad name')).toThrow(TypeError)
    expect(() => headers.has(':path')).toThrow(TypeError)
    expect(rawHeadersReads).toBe(0)

    expect([...headers]).toEqual([['x-test', 'value']])
    expect(rawHeadersReads).toBe(1)
  })

  it.each(nonJoinedHeaderNames)(
    'combines repeated %s values consistently before and after iteration',
    (name) => {
      const rawHeaders = [name, 'one', name, 'two']
      const collapsed = { [name]: 'one' }

      const before = lightweightHeaders(incoming(rawHeaders, collapsed))
      expect(before.get(name)).toBe('one, two')
      expect(before.has(name)).toBe(true)

      const after = lightweightHeaders(incoming(rawHeaders, collapsed))
      void [...after]
      expect(after.get(name)).toBe('one, two')
    }
  )

  it('combines headers collapsed by the HTTP/2 parser', () => {
    const headers = lightweightHeaders(
      incomingHttp2(['if-none-match', '"a"', 'if-none-match', '"b"'], {
        'if-none-match': '"a"',
      })
    )

    expect(headers.get('if-none-match')).toBe('"a", "b"')
    void [...headers]
    expect(headers.get('if-none-match')).toBe('"a", "b"')
  })

  it('uses an immutable raw-header snapshot for HTTP/2', () => {
    const rawHeaders = ['x-secret', 'topsecret', 'host', 'localhost']
    const request = incomingHttp2(rawHeaders, {
      'x-secret': 'topsecret',
      host: 'localhost',
    })
    const headers = lightweightHeaders(request)

    delete request.headers['x-secret']
    request.headers['x-added'] = 'value'
    rawHeaders[1] = 'changed'
    rawHeaders.push('x-added', 'value')

    expect(headers.get('x-secret')).toBe('topsecret')
    expect(headers.has('x-added')).toBe(false)
    void [...headers]
    expect(headers.get('x-secret')).toBe('topsecret')
    expect(headers.has('x-added')).toBe(false)
  })

  it('ignores non-string values in synthesized parsed headers', () => {
    const headers = lightweightHeaders(
      incoming(['content-length', '123'], { 'content-length': 123 })
    )

    expect(headers.get('content-length')).toBe('123')
    expect(headers.has('content-length')).toBe(true)
    void [...headers]
    expect(headers.get('content-length')).toBe('123')
  })

  it('normalizes raw values consistently before and after materialization', () => {
    const rawHeaders = ['x-token', '  abc\t', 'x-tab', '\tv v\t', 'x-interior', 'a  b']
    const headers = lightweightHeaders(incomingHttp2(rawHeaders, {}))

    expect(headers.get('x-token')).toBe('abc')
    expect(headers.get('x-tab')).toBe('v v')
    expect(headers.get('x-interior')).toBe('a  b')
    void [...headers]
    expect(headers.get('x-token')).toBe('abc')
    expect(headers.get('x-tab')).toBe('v v')
    expect(headers.get('x-interior')).toBe('a  b')
  })

  it('fails closed on values rejected by native Headers', () => {
    const rawHeaders = ['x-evil', 'ok', 'x-evil', 'bad\0value']

    expect(() => lightweightHeaders(incomingHttp2(rawHeaders, {})).get('x-evil')).toThrow(TypeError)
    expect(() => lightweightHeaders(incomingHttp2(rawHeaders, {})).has('x-evil')).toThrow(TypeError)
    expect(() => [...lightweightHeaders(incomingHttp2(rawHeaders, {}))]).toThrow(TypeError)
  })

  it('preserves cookie and set-cookie representations', () => {
    const headers = lightweightHeaders(
      incoming(['cookie', 'a=1', 'cookie', 'b=2', 'set-cookie', 'a=1', 'set-cookie', 'b=2'], {
        cookie: 'a=1; b=2',
        'set-cookie': ['ignored'],
      })
    )

    expect(headers.get('cookie')).toBe('a=1; b=2')
    expect(headers.get('set-cookie')).toBe('a=1, b=2')
    expect(headers.getSetCookie()).toEqual(['a=1', 'b=2'])
    expect(Object.fromEntries(headers).cookie).toBe('a=1; b=2')
  })

  it('reads a literal __proto__ header without exposing prototype properties', () => {
    const headers = lightweightHeaders(
      incoming(['__proto__', 'value', 'x-test', 'one'], { 'x-test': 'one' })
    )

    expect(headers.get('__proto__')).toBe('value')
    expect(headers.has('__proto__')).toBe(true)
    expect(headers.get('toString')).toBe(null)
    expect(headers.has('toString')).toBe(false)
  })

  it('materializes for validation and mutation while preserving identity', () => {
    const headers = lightweightHeaders(incoming(['host', 'localhost'], { host: 'localhost' }))

    expect(() => headers.get('bad name')).toThrow(TypeError)
    expect(() => headers.has(':path')).toThrow(TypeError)
    headers.set('x-test', 'value')
    headers.append('x-test', 'second')

    expect(headers.get('x-test')).toBe('value, second')
    let callbackParent: GlobalHeaders | undefined
    headers.forEach((_value, _key, parent) => {
      callbackParent = parent
    })
    expect(callbackParent).toBe(headers)
  })

  it('uses the lightweight inspection format', () => {
    const headers = lightweightHeaders(incoming(['x-test', 'value'], { 'x-test': 'value' }))

    expect(inspect(headers)).toContain("Headers (lightweight) { 'x-test': 'value' }")
  })

  it('leaves the standard Headers constructor unchanged', () => {
    const headers = new Headers({ 'x-test': 'one' })
    headers.append('x-test', 'two')

    expect(global.Headers).toBe(GlobalHeaders)
    expect(Object.getPrototypeOf(headers)).toBe(GlobalHeaders.prototype)
    expect(headers.get('x-test')).toBe('one, two')
    expect(new Headers(headers).get('x-test')).toBe('one, two')
    expect(new Headers({ rawHeaders: 'ordinary value' }).get('rawHeaders')).toBe('ordinary value')
  })

  it('uses the internal implementation without replacing the global constructor', () => {
    const request = incoming(['x-test', 'value'], { 'x-test': 'value' })
    const headers = newHeadersFromIncoming(request)

    expect(global.Headers).toBe(GlobalHeaders)
    expect(Object.getPrototypeOf(headers)).toBe(RequestHeaders.prototype)
    expect(headers).toBeInstanceOf(GlobalHeaders)
    expect(new GlobalHeaders(headers).get('x-test')).toBe('value')
  })

  it('uses the live global Headers constructor when it changes after module initialization', () => {
    class PolyfillHeaders extends GlobalHeaders {}
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'Headers')
    Object.defineProperty(globalThis, 'Headers', {
      value: PolyfillHeaders,
      configurable: true,
      writable: true,
    })

    try {
      const headers = newHeadersFromIncoming(incoming(['x-test', 'value'], { 'x-test': 'value' }))

      expect(headers).toBeInstanceOf(PolyfillHeaders)
      expect(Object.getPrototypeOf(headers)).toBe(PolyfillHeaders.prototype)
      expect(headers.get('x-test')).toBe('value')
    } finally {
      Object.defineProperty(globalThis, 'Headers', descriptor!)
    }
  })

  it('can initialize and clone a native Request after header mutation', () => {
    const request = newRequest({
      method: 'GET',
      url: '/',
      headers: { host: 'localhost' },
      rawHeaders: ['host', 'localhost'],
    } as IncomingMessage)
    const headers = request.headers
    headers.set('x-test', 'value')

    expect(request.keepalive).toBe(false)
    expect(request.headers).toBe(headers)
    expect(new LightweightRequest(request).headers.get('x-test')).toBe('value')
  })
})
