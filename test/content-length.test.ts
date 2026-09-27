import { Hono } from 'hono'
import { createServer } from 'node:http'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createServer as createHttp2Server } from 'node:http2'
import { getRequestListener } from '../src/listener'
import { defaultContentType } from '../src/response'
import { createAdaptorServer } from '../src/server'
import { requestServer, requestServerHttp2 } from './helpers/request'

// These tests exercise Node's real HTTP serializer. In addition to correctness,
// assert that plain headers reach writeHead with the original record:
// silently falling back to a copy must not hide a change to Node's internals.
describe('automatic Content-Length compatibility', () => {
  it.each(['', 'hello'])('serializes a frozen record without a copy: %j', async (body) => {
    const headers = Object.freeze({ 'content-type': 'text/plain' })
    let writeHeadCalls: unknown[][] = []
    const listener = getRequestListener(() => new Response(body, { headers }))
    const server = createServer((incoming, outgoing) => {
      writeHeadCalls = vi.spyOn(outgoing, 'writeHead').mock.calls
      void listener(incoming, outgoing)
    })
    const res = await requestServer(server, { path: '/' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(body)))
    expect(res.headers.has('transfer-encoding')).toBe(false)
    expect(await res.text()).toBe(body)
    expect(writeHeadCalls[0][1]).toBe(headers)
  })

  it('preserves the byte length for c.json()', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ message: 'hello' }))
    const server = createServer(getRequestListener(app.fetch))
    const res = await requestServer(server, { path: '/' })
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ message: 'hello' })
    expect(res.headers.get('content-type')).toBe('application/json')
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(text)))
    expect(res.headers.has('transfer-encoding')).toBe(false)
  })

  it('uses automatic length for JSON with a plain header record', async () => {
    const headers = Object.freeze({ 'Content-Type': 'application/json' })
    let writeHeadCalls: unknown[][] = []
    const listener = getRequestListener(
      () => new Response(JSON.stringify({ message: 'hello' }), { headers })
    )
    const server = createServer((incoming, outgoing) => {
      writeHeadCalls = vi.spyOn(outgoing, 'writeHead').mock.calls
      void listener(incoming, outgoing)
    })
    const res = await requestServer(server, { path: '/' })
    const text = await res.text()
    expect(JSON.parse(text)).toEqual({ message: 'hello' })
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(text)))
    expect(writeHeadCalls[0][1]).toBe(headers)
  })

  it('uses the UTF-8 byte length for automatic Content-Length with c.text()', async () => {
    const app = new Hono()
    app.get('/', (c) => c.text('こんにちは'))
    let writeHeadCalls: unknown[][] = []
    const listener = getRequestListener(app.fetch)
    const server = createServer((incoming, outgoing) => {
      outgoing.strictContentLength = true
      writeHeadCalls = vi.spyOn(outgoing, 'writeHead').mock.calls
      void listener(incoming, outgoing)
    })
    const res = await requestServer(server, { path: '/' })
    expect(await res.text()).toBe('こんにちは')
    expect(res.headers.get('content-type')).toBe(defaultContentType)
    expect(res.headers.get('content-length')).toBe('15')
    expect(res.headers.has('transfer-encoding')).toBe(false)
    expect(writeHeadCalls[0][1]).toEqual({ 'Content-Type': defaultContentType })
  })

  describe.each([
    { protocol: 'HTTP/1.1', serverOptions: {}, request: requestServer },
    {
      protocol: 'HTTP/2',
      serverOptions: { createServer: createHttp2Server },
      request: requestServerHttp2,
    },
  ])('default headers over $protocol', ({ serverOptions, request }) => {
    it.each([
      { name: 'string', makeBody: (text: string) => text },
      { name: 'Uint8Array', makeBody: (text: string) => new TextEncoder().encode(text) },
      { name: 'Blob', makeBody: (text: string) => new Blob([text]) },
    ])('preserves byte lengths for a $name body', async ({ makeBody }) => {
      const bodies = ['', 'hello']
      let index = 0
      const server = createAdaptorServer({
        fetch: () => new Response(makeBody(bodies[index++])),
        ...serverOptions,
      })
      for (const body of bodies) {
        const res = await request(server, { path: '/' })
        expect(res.status).toBe(200)
        expect(res.headers.get('content-type')).toBe(defaultContentType)
        expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(body)))
        expect(res.headers.has('transfer-encoding')).toBe(false)
        expect(await res.text()).toBe(body)
      }
    })
  })

  it.each([204, 304])(
    'preserves explicit length when status %i suppresses the body',
    async (status) => {
      const server = createServer(getRequestListener(() => new Response('hello', { status })))
      const res = await requestServer(server, { path: '/' })
      expect(res.status).toBe(status)
      expect(res.headers.get('content-length')).toBe('5')
      expect(await res.text()).toBe('')
    }
  )

  describe.each([false, true])('custom headers: %s', (customHeaders) => {
    it.each([
      {
        name: 'HEAD',
        method: 'HEAD',
        prepare: () => {},
      },
      {
        name: 'previously set Content-Length',
        method: 'GET',
        prepare: (_incoming: IncomingMessage, outgoing: ServerResponse) => {
          outgoing.setHeader('Content-Length', '999')
        },
      },
      {
        name: 'previously removed Content-Length',
        method: 'GET',
        prepare: (_incoming: IncomingMessage, outgoing: ServerResponse) => {
          outgoing.removeHeader('Content-Length')
        },
      },
      {
        name: 'disabled default chunking',
        method: 'GET',
        prepare: (_incoming: IncomingMessage, outgoing: ServerResponse) => {
          outgoing.useChunkedEncodingByDefault = false
        },
      },
      {
        name: 'unavailable native length',
        method: 'GET',
        prepare: (_incoming: IncomingMessage, outgoing: ServerResponse) => {
          Object.defineProperty(outgoing, '_contentLength', { value: undefined })
        },
      },
      {
        name: 'already initialized native length',
        method: 'GET',
        prepare: (_incoming: IncomingMessage, outgoing: ServerResponse) => {
          Object.defineProperty(outgoing, '_contentLength', { value: 999 })
        },
      },
    ])('preserves explicit length behavior for $name', async ({ method, prepare }) => {
      const headers = customHeaders ? Object.freeze({ 'content-type': 'text/plain' }) : undefined
      const listener = getRequestListener(() => new Response('hello', { headers }))
      const server = createServer((incoming, outgoing) => {
        prepare(incoming, outgoing)
        void listener(incoming, outgoing)
      })
      const res = await requestServer(server, { path: '/', method })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-length')).toBe('5')
      expect(await res.text()).toBe(method === 'HEAD' ? '' : 'hello')
    })
  })

  it('honors strictContentLength for JSON', async () => {
    const app = new Hono()
    app.get('/', (c) => c.json({ message: 'hello' }))
    const listener = getRequestListener(app.fetch)
    const server = createServer((incoming, outgoing) => {
      outgoing.strictContentLength = true
      void listener(incoming, outgoing)
    })
    const res = await requestServer(server, { path: '/' })
    const text = await res.text()
    expect(res.status).toBe(200)
    expect(JSON.parse(text)).toEqual({ message: 'hello' })
    expect(res.headers.get('content-length')).toBe(String(Buffer.byteLength(text)))
  })

  it('preserves the spelling of an explicit Content-Length value', async () => {
    const headers = Object.freeze({ 'cOnTeNt-LeNgTh': '00005' })
    const server = createServer(getRequestListener(() => new Response('hello', { headers })))
    const res = await requestServer(server, { path: '/' })
    expect(res.headers.get('content-length')).toBe('00005')
    expect(await res.text()).toBe('hello')
  })
})
