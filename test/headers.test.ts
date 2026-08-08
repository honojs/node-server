import type { IncomingMessage } from 'node:http'
import { inspect } from 'node:util'
import {
  GlobalHeaders,
  Headers as LightweightHeaders,
  newHeadersFromIncoming,
} from '../src/headers'
import { newRequest, Request as LightweightRequest } from '../src/request'

// Compatibility cases adapted from srvx's Node header suite:
// https://github.com/h3js/srvx/blob/4052594e76d5ead2cc4c7cf8f7fa6d5ea9558a0a/test/node-headers.test.ts

const incoming = (
  rawHeaders: string[],
  headers: Record<string, string | string[]>
): IncomingMessage => ({ rawHeaders, headers }) as IncomingMessage

const lightweightHeaders = (request: IncomingMessage): GlobalHeaders => {
  Object.defineProperty(global, 'Headers', {
    value: LightweightHeaders,
    writable: true,
  })
  return newHeadersFromIncoming(request)
}

describe('Headers', () => {
  beforeEach(() => {
    Object.defineProperty(global, 'Headers', {
      value: GlobalHeaders,
      writable: true,
    })
  })

  afterEach(() => {
    Object.defineProperty(global, 'Headers', {
      value: GlobalHeaders,
      writable: true,
    })
  })

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

    expect([...headers]).toEqual([['x-test', 'value']])
    expect(rawHeadersReads).toBe(1)
  })

  it('combines repeated headers consistently before and after iteration', () => {
    const rawHeaders = [
      'authorization',
      'Bearer AAA',
      'authorization',
      'Bearer BBB',
      'content-type',
      'text/plain',
      'content-type',
      'application/json',
    ]
    const collapsed = { authorization: 'Bearer AAA', 'content-type': 'text/plain' }

    const before = lightweightHeaders(incoming(rawHeaders, collapsed))
    expect(before.get('authorization')).toBe('Bearer AAA, Bearer BBB')
    expect(before.get('content-type')).toBe('text/plain, application/json')
    expect(before.has('authorization')).toBe(true)

    const after = lightweightHeaders(incoming(rawHeaders, collapsed))
    void [...after]
    expect(after.get('authorization')).toBe('Bearer AAA, Bearer BBB')
    expect(after.get('content-type')).toBe('text/plain, application/json')
  })

  it('preserves cookie and set-cookie representations', () => {
    const headers = lightweightHeaders(
      incoming(['cookie', 'a=1', 'cookie', 'b=2', 'set-cookie', 'a=1', 'set-cookie', 'b=2'], {
        cookie: 'a=1; b=2',
        'set-cookie': ['a=1', 'b=2'],
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

  it('supports the standard Headers constructor when installed globally', () => {
    Object.defineProperty(global, 'Headers', {
      value: LightweightHeaders,
      writable: true,
    })

    const headers = new Headers({ 'x-test': 'one' })
    headers.append('x-test', 'two')

    expect(headers.get('x-test')).toBe('one, two')
    expect(new Headers(headers).get('x-test')).toBe('one, two')
    expect(new Headers({ rawHeaders: 'ordinary value' }).get('rawHeaders')).toBe('ordinary value')
  })

  it('selects the implementation from the active global', () => {
    const request = incoming(['x-test', 'value'], { 'x-test': 'value' })
    const native = newHeadersFromIncoming(request)
    expect(Object.getPrototypeOf(native)).toBe(GlobalHeaders.prototype)

    Object.defineProperty(global, 'Headers', {
      value: LightweightHeaders,
      writable: true,
    })
    const lightweight = newHeadersFromIncoming(request)
    expect(Object.getPrototypeOf(lightweight)).toBe(LightweightHeaders.prototype)
  })

  it('can initialize and clone a native Request after header mutation', () => {
    Object.defineProperty(global, 'Headers', {
      value: LightweightHeaders,
      writable: true,
    })
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
