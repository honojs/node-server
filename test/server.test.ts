import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { compress } from 'hono/compress'
import { etag } from 'hono/etag'
import { poweredBy } from 'hono/powered-by'
import { stream } from 'hono/streaming'
import fs from 'node:fs'
import { createServer as createHttp2Server } from 'node:http2'
import { createServer as createHTTPSServer } from 'node:https'
import { gunzipSync, inflateSync } from 'node:zlib'
import { GlobalRequest, Request as LightweightRequest, getAbortController } from '../src/request'
import { GlobalResponse, Response as LightweightResponse } from '../src/response'
import { createAdaptorServer, serve } from '../src/server'
import type { HttpBindings, ServerType } from '../src/types'
import { app } from './app'
import { requestServer, requestServerChunked, requestServerHttp2 } from './helpers/request'

describe('Basic', () => {
  const server = createAdaptorServer(app)

  it('Should return 200 response - GET /', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(await res.text()).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /url', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/url' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    const url = new URL(await res.text())
    expect(url.pathname).toBe('/url')
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.protocol).toBe('http:')
  })

  it('Should return 200 response - GET /posts?page=2', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/posts?page=2' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Page 2')
  })

  it('Should return 200 response - GET /user-agent', async () => {
    const res = await requestServer(server, {
      method: 'GET',
      path: '/user-agent',
      headers: { 'user-agent': 'Hono' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(await res.text()).toBe('Hono')
  })

  it('Should return 302 response - POST /posts', async () => {
    const res = await requestServer(server, { method: 'POST', path: '/posts' })
    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('/posts')
  })

  it('Should return 200 response - POST /no-body-consumed', async () => {
    const res = await requestServer(server, {
      method: 'POST',
      path: '/no-body-consumed',
      headers: { 'content-length': '0' },
      body: '',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('No body consumed')
  })

  it('Should return 200 response - POST /body-cancelled', async () => {
    const res = await requestServer(server, {
      method: 'POST',
      path: '/body-cancelled',
      headers: { 'content-length': '0' },
      body: '',
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Body cancelled')
  })

  it('Should return 200 response - POST /partially-consumed', async () => {
    const buffer = Buffer.alloc(1024 * 10) // large buffer
    const res = await requestServer(server, {
      method: 'POST',
      path: '/partially-consumed',
      headers: { 'content-length': buffer.length.toString() },
      body: buffer,
    })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Partially consumed')
  })

  it('Should return 200 response - POST /partially-consumed-and-cancelled', async () => {
    const buffer = Buffer.alloc(1) // A large buffer will not make the test go far, so keep it small because it won't go far.
    const res = await requestServer(server, {
      method: 'POST',
      path: '/partially-consumed-and-cancelled',
      headers: { 'content-length': buffer.length.toString() },
      body: buffer,
    })

    expect(res.status).toBe(200)
    expect(await res.text()).toBe('Partially consumed and cancelled')
  })

  it('Should return 201 response - DELETE /posts/123', async () => {
    const res = await requestServer(server, { method: 'DELETE', path: '/posts/123' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('DELETE 123')
  })

  it('Should return 500 response - GET /invalid', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/invalid' })
    expect(res.status).toBe(500)
    expect(res.headers.get('content-type')).toEqual('text/plain')
  })

  it('Should return 200 response - GET /ponyfill', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/ponyfill' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(await res.text()).toBe('Pony')
  })

  it('Should not raise error for TRACE method', async () => {
    const res = await requestServer(server, { method: 'TRACE', path: '/' })
    expect(await res.text()).toBe('headers: {}')
  })
})

describe('various response body types', () => {
  const runner = (Response: typeof GlobalResponse) => {
    const largeText = 'a'.repeat(1024 * 1024 * 10)
    let server: ServerType
    let resolveReadableStreamPromise: () => void
    let resolveEventStreamPromise: () => void
    let resolveEventStreamWithoutTransferEncodingPromise: () => void
    beforeAll(() => {
      const app = new Hono()
      app.use('*', async (c, next) => {
        await next()

        // generate internal response object
        const status = c.res.status
        if (status > 999) {
          c.res = new Response('Internal Server Error', { status: 500 })
        }
      })
      app.get('/', () => {
        const response = new Response('Hello! Node!')
        return response
      })
      app.get('/large', () => {
        // 10MB text
        const response = new Response(largeText)
        return response
      })
      app.get('/uint8array', () => {
        const response = new Response(new Uint8Array([1, 2, 3]), {
          headers: { 'content-type': 'application/octet-stream' },
        })
        return response
      })
      app.get('/blob', () => {
        const response = new Response(new Blob([new Uint8Array([1, 2, 3])]), {
          headers: { 'content-type': 'application/octet-stream' },
        })
        return response
      })
      const readableStreamPromise = new Promise<void>((resolve) => {
        resolveReadableStreamPromise = resolve
      })
      app.get('/readable-stream', () => {
        const stream = new ReadableStream({
          async start(controller) {
            await readableStreamPromise
            controller.enqueue('Hello!')
            controller.enqueue(' Node!')
            controller.close()
          },
        })
        return new Response(stream)
      })
      app.get('/readable-stream-with-transfer-encoding', () => {
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue('Hello!') // send one chunk synchronously
            controller.close()
          },
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/plain; charset=UTF-8',
            'transfer-encoding': 'chunked',
          },
        })
      })
      const eventStreamPromise = new Promise<void>((resolve) => {
        resolveEventStreamPromise = resolve
      })
      app.get('/event-stream', () => {
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue('data: First!\n\n')
            await eventStreamPromise
            controller.enqueue('data: Second!\n\n')
            controller.close()
          },
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
            'transfer-encoding': 'chunked',
          },
        })
      })
      const eventStreamWithoutTransferEncodingPromise = new Promise<void>((resolve) => {
        resolveEventStreamWithoutTransferEncodingPromise = resolve
      })
      app.get('/event-stream-without-transfer-encoding', () => {
        const stream = new ReadableStream({
          async start(controller) {
            controller.enqueue('data: First!\n\n')
            await eventStreamWithoutTransferEncodingPromise
            controller.enqueue('data: Second!\n\n')
            controller.close()
          },
        })
        return new Response(stream, {
          headers: {
            'content-type': 'text/event-stream',
          },
        })
      })
      app.get('/buffer', () => {
        const response = new Response(Buffer.from('Hello Hono!'), {
          headers: { 'content-type': 'text/plain' },
        })
        return response
      })
      app.get('/text-with-content-length-object', () => {
        const response = new Response('Hello Hono!', {
          headers: { 'content-type': 'text/plain', 'content-length': '00011' },
        })
        return response
      })
      app.get('/text-with-content-length-headers', () => {
        const response = new Response('Hello Hono!', {
          headers: new Headers({ 'content-type': 'text/plain', 'content-length': '00011' }),
        })
        return response
      })
      app.get('/text-with-content-length-array', () => {
        const response = new Response('Hello Hono!', {
          headers: [
            ['content-type', 'text/plain'],
            ['content-length', '00011'],
          ],
        })
        return response
      })
      app.get('/text-with-set-cookie-array', () => {
        const response = new Response('Hello Hono!', {
          headers: [
            ['content-type', 'text/plain'],
            ['set-cookie', 'a=1'],
            ['set-cookie', 'b=2'],
          ],
        })
        return response
      })

      app.use('/etag/*', etag())
      app.get('/etag/buffer', () => {
        const response = new Response(Buffer.from('Hello Hono!'), {
          headers: { 'content-type': 'text/plain' },
        })
        return response
      })

      server = createAdaptorServer(app)
    })

    it('Should return 200 response - GET /', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.get('content-length')).toMatch('12')
      expect(await res.text()).toBe('Hello! Node!')
    })

    it('Should return 200 response - GET /large', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/large' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.get('content-length')).toMatch(largeText.length.toString())
      expect(await res.text()).toBe(largeText)
    })

    it('Should return 200 response - GET /uint8array', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/uint8array' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('application/octet-stream')
      expect(res.headers.get('content-length')).toMatch('3')
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
    })

    it('Should return 200 response - GET /blob', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/blob' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('application/octet-stream')
      expect(res.headers.get('content-length')).toMatch('3')
      expect(Buffer.from(await res.arrayBuffer())).toEqual(Buffer.from([1, 2, 3]))
    })

    it('Should return 200 response - GET /readable-stream', async () => {
      const { chunks, response: res } = await requestServerChunked(
        server,
        { method: 'GET', path: '/readable-stream' },
        {
          onHeaders: (headers) => {
            // response header should be sent before sending data.
            expect(headers.get('transfer-encoding')).toBe('chunked')
            resolveReadableStreamPromise()
          },
        }
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain; charset=UTF-8')
      expect(res.headers.get('content-length')).toBeNull()
      expect(chunks.map((chunk) => chunk.toString())).toEqual(['Hello!', ' Node!'])
    })

    it('Should return 200 response - GET /readable-stream-with-transfer-encoding', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/readable-stream-with-transfer-encoding',
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain; charset=UTF-8')
      expect(res.headers.get('transfer-encoding')).toBe('chunked')
      expect(res.headers.get('content-length')).toBeNull()
    })

    it('Should return 200 response - GET /event-stream', async () => {
      const { chunks, response: res } = await requestServerChunked(
        server,
        { method: 'GET', path: '/event-stream' },
        {
          onHeaders: (headers) => {
            // response header should be sent before sending data.
            expect(headers.get('transfer-encoding')).toBe('chunked')
            resolveEventStreamPromise()
          },
        }
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/event-stream')
      expect(res.headers.get('content-length')).toBeNull()
      expect(chunks.map((chunk) => chunk.toString())).toEqual([
        'data: First!\n\n',
        'data: Second!\n\n',
      ])
    })

    it('Should return 200 response - GET /event-stream-without-transfer-encoding', async () => {
      const { chunks, response: res } = await requestServerChunked(
        server,
        { method: 'GET', path: '/event-stream-without-transfer-encoding' },
        {
          onChunk: (_chunk, index) => {
            if (index === 0) {
              // receive first chunk
              resolveEventStreamWithoutTransferEncodingPromise()
            }
          },
        }
      )
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/event-stream')
      expect(res.headers.get('content-length')).toBeNull()
      expect(chunks.map((chunk) => chunk.toString())).toEqual([
        'data: First!\n\n',
        'data: Second!\n\n',
      ])
    })

    it('Should return 200 response - GET /buffer', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/buffer' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.get('content-length')).toMatch('11')
      expect(await res.text()).toBe('Hello Hono!')
    })

    it('Should return 200 response - GET /text-with-content-length-object', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/text-with-content-length-object',
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.get('content-length')).toBe('00011')
      expect(await res.text()).toBe('Hello Hono!')
    })

    it('Should return 200 response - GET /text-with-content-length-headers', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/text-with-content-length-headers',
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.get('content-length')).toBe('00011')
      expect(await res.text()).toBe('Hello Hono!')
    })

    it('Should return 200 response - GET /text-with-content-length-array', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/text-with-content-length-array',
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.get('content-length')).toBe('00011')
      expect(await res.text()).toBe('Hello Hono!')
    })

    it('Should return 200 response - GET /text-with-set-cookie-array', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/text-with-set-cookie-array',
      })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
      expect(await res.text()).toBe('Hello Hono!')
    })

    it('Should return 200 response - GET /etag/buffer', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/etag/buffer' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/plain')
      expect(res.headers.get('etag')).toMatch('"7e03b9b8ed6156932691d111c81c34c3c02912f9"')
      expect(res.headers.get('content-length')).toMatch('11')
      expect(await res.text()).toBe('Hello Hono!')
    })
  }

  describe('GlobalResponse', () => {
    runner(GlobalResponse)
  })

  describe('LightweightResponse', () => {
    runner(LightweightResponse as unknown as typeof GlobalResponse)
  })
})

describe('Routing', () => {
  describe('Nested Route', () => {
    const book = new Hono()
    book.get('/', (c) => c.text('get /book'))
    book.get('/:id', (c) => {
      return c.text('get /book/' + c.req.param('id'))
    })
    book.post('/', (c) => c.text('post /book'))

    const app = new Hono()
    app.route('/book', book)

    const server = createAdaptorServer(app)

    it('Should return responses from `/book/*`', async () => {
      let res = await requestServer(server, { method: 'GET', path: '/book' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('get /book')

      res = await requestServer(server, { method: 'GET', path: '/book/123' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('get /book/123')

      res = await requestServer(server, { method: 'POST', path: '/book' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('post /book')
    })
  })

  describe('Chained route', () => {
    const app = new Hono()

    app
      .get('/chained/:abc', (c) => {
        const abc = c.req.param('abc')
        return c.text(`GET for ${abc}`)
      })
      .post((c) => {
        const abc = c.req.param('abc')
        return c.text(`POST for ${abc}`)
      })
    const server = createAdaptorServer(app)

    it('Should return responses from `/chained/*`', async () => {
      let res = await requestServer(server, { method: 'GET', path: '/chained/abc' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('GET for abc')

      res = await requestServer(server, { method: 'POST', path: '/chained/abc' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('POST for abc')

      res = await requestServer(server, { method: 'PUT', path: '/chained/abc' })
      expect(res.status).toBe(404)
    })
  })
})

describe('Request body', () => {
  const app = new Hono()
  app.post('/json', async (c) => {
    const data = await c.req.json()
    return c.json(data)
  })
  app.post('/form', async (c) => {
    const data = await c.req.parseBody()
    return c.json(data)
  })
  const server = createAdaptorServer(app)

  it('Should handle JSON body', async () => {
    const res = await requestServer(server, {
      method: 'POST',
      path: '/json',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ foo: 'bar' })
  })

  it('Should handle form body', async () => {
    const res = await requestServer(server, {
      method: 'POST',
      path: '/form',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: 'foo=bar',
    })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ foo: 'bar' })
  })
})

describe('Response body', () => {
  describe('Cached Response', () => {
    const app = new Hono()
    app.get('/json', (c) => {
      return c.json({ foo: 'bar' })
    })
    app.get('/json-async', async (c) => {
      return c.json({ foo: 'async' })
    })
    app.get('/html', (c) => {
      return c.html('<h1>Hello!</h1>')
    })
    app.get('/html-async', async (c) => {
      return c.html('<h1>Hello!</h1>')
    })
    const server = createAdaptorServer(app)

    it('Should return JSON body', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/json' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('application/json')
      expect(await res.json()).toEqual({ foo: 'bar' })
    })

    it('Should return JSON body from /json-async', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/json-async' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('application/json')
      expect(await res.json()).toEqual({ foo: 'async' })
    })

    it('Should return HTML', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/html' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/html')
      expect(await res.text()).toBe('<h1>Hello!</h1>')
    })

    it('Should return HTML from /html-async', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/html-async' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('text/html')
      expect(await res.text()).toBe('<h1>Hello!</h1>')
    })
  })

  describe('Fallback to global.Response', () => {
    const app = new Hono()

    app.get('/json-blob', async () => {
      return new Response(new Blob([JSON.stringify({ foo: 'blob' })]), {
        headers: { 'content-type': 'application/json' },
      })
    })

    app.get('/json-buffer', async () => {
      return new Response(new TextEncoder().encode(JSON.stringify({ foo: 'buffer' })).buffer, {
        headers: { 'content-type': 'application/json' },
      })
    })

    const server = createAdaptorServer(app)

    it('Should return JSON body from /json-blob', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/json-blob' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('application/json')
      expect(await res.json()).toEqual({ foo: 'blob' })
    })

    it('Should return JSON body from /json-buffer', async () => {
      const res = await requestServer(server, { method: 'GET', path: '/json-buffer' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toMatch('application/json')
      expect(await res.json()).toEqual({ foo: 'buffer' })
    })
  })
})

describe('Middleware', () => {
  const app = new Hono<{ Variables: { foo: string } }>()
  app.use('*', poweredBy())
  app.use('*', async (c, next) => {
    c.set('foo', 'bar')
    await next()
    c.header('foo', c.get('foo'))
  })
  app.get('/', (c) => c.text('Hello! Middleware!'))
  const server = createAdaptorServer(app)

  it('Should have correct header values', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/' })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-powered-by')).toBe('Hono')
    expect(res.headers.get('foo')).toBe('bar')
  })
})

describe('Error handling', () => {
  const app = new Hono()
  app.notFound((c) => {
    return c.text('Custom NotFound', 404)
  })
  app.onError((_, c) => {
    return c.text('Custom Error!', 500)
  })
  app.get('/error', () => {
    throw new Error()
  })
  const server = createAdaptorServer(app)

  it('Should return 404 response', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/' })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('Custom NotFound')
  })

  it('Should return 500 response', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/error' })
    expect(res.status).toBe(500)
    expect(await res.text()).toBe('Custom Error!')
  })

  it('Should return 404 response - PURGE method', async () => {
    const res = await requestServer(server, { method: 'PURGE', path: '/' })
    expect(res.status).toBe(404)
  })
})

describe('Basic Auth Middleware', () => {
  const app = new Hono()
  const username = 'hono-user-a'
  const password = 'hono-password-a'
  const unicodePassword = '炎'

  app.use(
    '/auth/*',
    basicAuth({
      username,
      password,
    })
  )

  app.use(
    '/auth-unicode/*',
    basicAuth({
      username: username,
      password: unicodePassword,
    })
  )

  app.get('/auth/*', (c) => c.text('auth'))
  app.get('/auth-unicode/*', (c) => c.text('auth'))

  const server = createAdaptorServer(app)

  it('Should not authorized', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/auth/a' })
    expect(res.status).toBe(401)
    expect(await res.text()).toBe('Unauthorized')
  })

  it('Should authorized', async () => {
    const credential = Buffer.from(username + ':' + password).toString('base64')
    const res = await requestServer(server, {
      method: 'GET',
      path: '/auth/a',
      headers: { authorization: `Basic ${credential}` },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('auth')
  })

  it('Should authorize Unicode', async () => {
    const credential = Buffer.from(username + ':' + unicodePassword).toString('base64')
    const res = await requestServer(server, {
      method: 'GET',
      path: '/auth-unicode/a',
      headers: { authorization: `Basic ${credential}` },
    })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('auth')
  })
})

describe('Stream and non-stream response', () => {
  const app = new Hono()

  app.get('/json', (c) => c.json({ foo: 'bar' }))
  app.get('/text', (c) => c.text('Hello!'))
  app.get('/json-stream', (c) => {
    c.header('x-accel-buffering', 'no')
    c.header('content-type', 'application/json')
    return stream(c, async (stream) => {
      stream.write(JSON.stringify({ foo: 'bar' }))
    })
  })
  app.get('/stream', (c) => {
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue('data: Hello!\n\n')
        await new Promise((resolve) => setTimeout(resolve, 100))
        controller.enqueue('data: end\n\n')
        controller.close()
      },
    })

    c.header('Content-Type', 'text/event-stream; charset=utf-8')
    return c.body(stream)
  })

  app.get('/error-stream', (c) => {
    const stream = new ReadableStream({
      async start(controller) {
        controller.enqueue('data: Hello!\n\n')
        await new Promise((resolve) => setTimeout(resolve, 100))
        controller.enqueue('data: end\n\n')
        controller.error(new Error('test'))
      },
    })

    c.header('Content-Type', 'text/event-stream; charset=utf-8')
    return c.body(stream)
  })

  const server = createAdaptorServer(app)

  it('Should return JSON body', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/json' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toMatch('13')
    expect(res.headers.get('content-type')).toMatch('application/json')
    expect(await res.json()).toEqual({ foo: 'bar' })
  })

  it('Should return text body', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/text' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toMatch('6')
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(await res.text()).toBe('Hello!')
  })

  it('Should return JSON body - stream', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/json-stream' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-type')).toMatch('application/json')
    expect(res.headers.get('transfer-encoding')).toMatch('chunked')
    expect(await res.json()).toEqual({ foo: 'bar' })
  })

  it('Should return text body - stream', async () => {
    const { chunks, response: res } = await requestServerChunked(server, {
      method: 'GET',
      path: '/stream',
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-length')).toBeNull()
    expect(res.headers.get('content-type')).toMatch('text/event-stream')
    expect(res.headers.get('transfer-encoding')).toMatch('chunked')
    expect(chunks.map((chunk) => chunk.toString())).toEqual(['data: Hello!\n\n', 'data: end\n\n'])
  })

  it('Should return error - stream without app crashing', async () => {
    const result = requestServer(server, { method: 'GET', path: '/error-stream' })
    await expect(result).rejects.toThrow('aborted')
  })
})

describe('SSL', () => {
  const app = new Hono()
  app.get('/', (c) => c.text('Hello! Node!'))
  app.get('/url', (c) => c.text(c.req.url))

  const server = createAdaptorServer({
    fetch: app.fetch,
    createServer: createHTTPSServer,
    serverOptions: {
      key: fs.readFileSync('test/fixtures/keys/agent1-key.pem'),
      cert: fs.readFileSync('test/fixtures/keys/agent1-cert.pem'),
    },
  })

  it('Should return 200 response - GET /', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(await res.text()).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /url', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/url' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    const url = new URL(await res.text())
    expect(url.pathname).toBe('/url')
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.protocol).toBe('https:')
  })
})

describe('HTTP2', () => {
  const app = new Hono()
  app.get('/', (c) => c.text('Hello! Node!'))
  app.get('/headers', (c) => {
    // call newRequestFromIncoming
    c.req.header('Accept')
    return c.text('Hello! Node!')
  })
  app.get('/url', (c) => c.text(c.req.url))

  const server = createAdaptorServer({
    fetch: app.fetch,
    createServer: createHttp2Server,
  })

  it('Should return 200 response - GET /', async () => {
    const res = await requestServerHttp2(server, { method: 'GET', path: '/' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(await res.text()).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /headers', async () => {
    const res = await requestServerHttp2(server, { method: 'GET', path: '/headers' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(await res.text()).toBe('Hello! Node!')
  })

  // Use :authority as the host for the url.
  it('Should return 200 response - GET /url', async () => {
    const res = await requestServerHttp2(server, {
      method: 'GET',
      path: '/url',
      headers: { ':authority': '127.0.0.1', ':scheme': 'https' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    const url = new URL(await res.text())
    expect(url.pathname).toBe('/url')
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.protocol).toBe('https:')
  })
})

describe('Hono compression default gzip', () => {
  const app = new Hono()
  app.use('*', compress())

  app.notFound((c) => {
    return c.text('Custom NotFound', 404)
  })

  app.onError((_, c) => {
    return c.text('Custom Error!', 500)
  })

  app.get('/error', () => {
    throw new Error()
  })

  app.get('/one', async (c) => {
    let body = 'one'

    for (let index = 0; index < 1000 * 1000; index++) {
      body += ' one'
    }
    return c.text(body)
  })

  it('should return 200 response - GET /one', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, {
      method: 'GET',
      path: '/one',
      headers: { 'accept-encoding': 'gzip, deflate' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(res.headers.get('content-encoding')).toMatch('gzip')
  })

  it('should return 404 Custom NotFound', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, {
      method: 'GET',
      path: '/err',
      headers: { 'accept-encoding': 'gzip, deflate' },
    })
    expect(res.status).toBe(404)
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toEqual('Custom NotFound')
    expect(res.headers.get('content-type')).toEqual('text/plain; charset=UTF-8')
    expect(res.headers.get('content-encoding')).toMatch('gzip')
  })

  it('should return 500 Custom Error!', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, {
      method: 'GET',
      path: '/error',
      headers: { 'accept-encoding': 'gzip, deflate' },
    })
    expect(res.status).toBe(500)
    expect(gunzipSync(Buffer.from(await res.arrayBuffer())).toString()).toEqual('Custom Error!')
    expect(res.headers.get('content-type')).toEqual('text/plain; charset=UTF-8')
    expect(res.headers.get('content-encoding')).toMatch('gzip')
  })
})

describe('Hono compression deflate', () => {
  const app = new Hono()
  app.use('*', compress({ encoding: 'deflate' }))

  app.notFound((c) => {
    return c.text('Custom NotFound', 404)
  })

  app.onError((_, c) => {
    return c.text('Custom Error!', 500)
  })

  app.get('/error', () => {
    throw new Error()
  })

  app.get('/one', async (c) => {
    let body = 'one'

    for (let index = 0; index < 1000 * 1000; index++) {
      body += ' one'
    }
    return c.text(body)
  })

  it('should return 200 response - GET /one', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, {
      method: 'GET',
      path: '/one',
      headers: { 'accept-encoding': 'gzip, deflate' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(res.headers.get('content-encoding')).toMatch('deflate')
  })

  it('should return 404 Custom NotFound', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, {
      method: 'GET',
      path: '/err',
      headers: { 'accept-encoding': 'gzip, deflate' },
    })
    expect(res.status).toBe(404)
    expect(inflateSync(Buffer.from(await res.arrayBuffer())).toString()).toEqual('Custom NotFound')
    expect(res.headers.get('content-type')).toEqual('text/plain; charset=UTF-8')
    expect(res.headers.get('content-encoding')).toMatch('deflate')
  })

  it('should return 500 Custom Error!', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, {
      method: 'GET',
      path: '/error',
      headers: { 'accept-encoding': 'gzip, deflate' },
    })
    expect(res.status).toBe(500)
    expect(inflateSync(Buffer.from(await res.arrayBuffer())).toString()).toEqual('Custom Error!')
    expect(res.headers.get('content-type')).toEqual('text/plain; charset=UTF-8')
    expect(res.headers.get('content-encoding')).toMatch('deflate')
  })
})

describe('set child response to c.res', () => {
  const app = new Hono()
  app.use('*', async (c, next) => {
    await next()
    c.res = new Response('', c.res)
    c.res.headers // If this is set, test fails
  })

  app.get('/json', async (c) => {
    return c.json({})
  })

  it('Should return 200 response - GET /json', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, { method: 'GET', path: '/json' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toMatch('application/json')
  })
})

describe('Headers appended to a raw Response after construction (issue #304)', () => {
  // Regression test: a handler returning `new Response(body, init)` and
  // appending headers (e.g. `Set-Cookie`) afterwards must not lose those
  // headers when middleware later clones the response via `new Response(...)`.
  const app = new Hono()
  app.use('*', async (c, next) => {
    await next()
    // Mimics what middleware such as `cors`/`compress` does internally.
    c.res = new Response(c.res.body, c.res)
  })
  app.post('/test', () => {
    const res = new Response('hello', {
      status: 200,
      headers: { 'Content-Type': 'text/plain' },
    })
    res.headers.append('Set-Cookie', 'session=abc; Path=/; HttpOnly')
    return res
  })

  it('Should preserve the appended Set-Cookie header', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, { method: 'POST', path: '/test' })
    expect(res.status).toBe(200)
    expect(await res.text()).toBe('hello')
    expect(res.headers.get('content-type')).toMatch('text/plain')
    expect(res.headers.getSetCookie()).toEqual(['session=abc; Path=/; HttpOnly'])
  })
})

describe('forwarding IncomingMessage and ServerResponse in env', () => {
  const app = new Hono<{ Bindings: HttpBindings }>()
  app.get('/', (c) =>
    c.json({
      incoming: c.env.incoming.constructor.name,
      url: c.env.incoming.url,
      outgoing: c.env.outgoing.constructor.name,
      status: c.env.outgoing.statusCode,
    })
  )

  it('Should add `incoming` and `outgoing` to env', async () => {
    const server = createAdaptorServer(app)
    const res = await requestServer(server, { method: 'GET', path: '/' })

    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.incoming).toBe('IncomingMessage')
    expect(body.url).toBe('/')
    expect(body.outgoing).toBe('ServerResponse')
    expect(body.status).toBe(200)
  })
})

describe('overrideGlobalObjects', () => {
  const app = new Hono()

  beforeEach(() => {
    Object.defineProperty(global, 'Request', {
      value: GlobalRequest,
      writable: true,
    })
    Object.defineProperty(global, 'Response', {
      value: GlobalResponse,
      writable: true,
    })
  })

  describe('default', () => {
    it('Should be overridden', () => {
      createAdaptorServer(app)
      expect(global.Request).toBe(LightweightRequest)
      expect(global.Response).toBe(LightweightResponse)
    })
  })

  describe('overrideGlobalObjects: true', () => {
    it('Should be overridden', () => {
      createAdaptorServer({ overrideGlobalObjects: true, fetch: app.fetch })
      expect(global.Request).toBe(LightweightRequest)
      expect(global.Response).toBe(LightweightResponse)
    })
  })

  describe('overrideGlobalObjects: false', () => {
    it('Should not be overridden', () => {
      createAdaptorServer({ overrideGlobalObjects: false, fetch: app.fetch })
      expect(global.Request).toBe(GlobalRequest)
      expect(global.Response).toBe(GlobalResponse)
    })
  })
})

describe('Memory leak test', () => {
  let counter = 0
  const registry = new FinalizationRegistry(() => {
    counter--
  })
  const app = new Hono()
  const server = createAdaptorServer(app)

  let onAbort: () => void
  let reqReadyResolve: () => void
  let reqReadyPromise: Promise<void>

  app.use(async (c, next) => {
    counter++
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    registry.register((c.req.raw as any)[getAbortController](), 'abortController')
    await next()
  })
  app.get('/', (c) => c.text('Hello! Node!'))
  app.post('/', async (c) => c.json(await c.req.json()))
  app.get('/abort', async (c) => {
    c.req.raw.signal.addEventListener('abort', () => onAbort())
    reqReadyResolve?.()
    await new Promise(() => {}) // never resolve
  })

  beforeEach(() => {
    counter = 0
    reqReadyPromise = new Promise<void>((r) => {
      reqReadyResolve = r
    })
  })

  // keep the server up across all tests so every request shares the same
  // environment, as the GC assertions are sensitive to their surroundings
  beforeAll(
    () =>
      new Promise<void>((resolve, reject) => {
        server.once('error', reject)
        server.listen(0, '127.0.0.1', resolve)
      })
  )

  afterAll(() => {
    server.close()
  })

  it('Should not have memory leak - GET /', async () => {
    await requestServer(server, { method: 'GET', path: '/' })
    global.gc?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(counter).toBe(0)
  })

  it('Should not have memory leak - POST /', async () => {
    await requestServer(server, {
      method: 'POST',
      path: '/',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ foo: 'bar' }),
    })
    global.gc?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(counter).toBe(0)
  })

  it('Should not have memory leak - GET /abort', async () => {
    const abortedPromise = new Promise<void>((resolve) => {
      onAbort = resolve
    })

    const controller = new AbortController()
    const resPromise = requestServer(server, {
      method: 'GET',
      path: '/abort',
      signal: controller.signal,
    }).catch(() => {})
    await reqReadyPromise
    controller.abort()
    await abortedPromise
    await resPromise
    await new Promise((resolve) => setTimeout(resolve, 10))

    global.gc?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(counter).toBe(0)
  })
})

describe('serve', () => {
  const app = new Hono()
  app.get('/', (c) => c.newResponse(null, 200))
  serve(app)

  it('should serve on ipv4', async () => {
    const response = await fetch('http://localhost:3000')
    expect(response.status).toBe(200)
  })

  it('should serve on ipv6', async () => {
    const response = await fetch('http://[::1]:3000')
    expect(response.status).toBe(200)
  })
})
