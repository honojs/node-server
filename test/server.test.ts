import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { compress } from 'hono/compress'
import { etag } from 'hono/etag'
import { poweredBy } from 'hono/powered-by'
import { stream } from 'hono/streaming'
import request from 'supertest'
import fs from 'node:fs'
import { createServer as createHttp2Server } from 'node:http2'
import { createServer as createHTTPSServer } from 'node:https'
import { GlobalRequest, Request as LightweightRequest, getAbortController } from '../src/request'
import { GlobalResponse, Response as LightweightResponse } from '../src/response'
import { createAdaptorServer, serve } from '../src/server'
import type { HttpBindings, ServerType } from '../src/types'
import { app } from './app'

describe('Basic', () => {
  const server = createAdaptorServer(app)

  it('Should return 200 response - GET /', async () => {
    const res = await request(server).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /url', async () => {
    const res = await request(server).get('/url').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    const url = new URL(res.text)
    expect(url.pathname).toBe('/url')
    expect(url.hostname).toBe('127.0.0.1')
    expect(url.protocol).toBe('http:')
  })

  it('Should return 200 response - GET /posts?page=2', async () => {
    const res = await request(server).get('/posts?page=2')
    expect(res.status).toBe(200)
    expect(res.text).toBe('Page 2')
  })

  it('Should return 200 response - GET /user-agent', async () => {
    const res = await request(server).get('/user-agent').set('user-agent', 'Hono')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Hono')
  })

  it('Should return 302 response - POST /posts', async () => {
    const res = await request(server).post('/posts')
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('/posts')
  })

  it('Should return 200 response - POST /no-body-consumed', async () => {
    const res = await request(server).post('/no-body-consumed').send('')
    expect(res.status).toBe(200)
    expect(res.text).toBe('No body consumed')
  })

  it('Should return 200 response - POST /body-cancelled', async () => {
    const res = await request(server).post('/body-cancelled').send('')
    expect(res.status).toBe(200)
    expect(res.text).toBe('Body cancelled')
  })

  it('Should return 200 response - POST /partially-consumed', async () => {
    const buffer = Buffer.alloc(1024 * 10) // large buffer
    const res = await new Promise<any>((resolve, reject) => {
      const req = request(server)
        .post('/partially-consumed')
        .set('Content-Length', buffer.length.toString())

      req.write(buffer)
      req.end((err, res) => {
        if (err) {
          reject(err)
        } else {
          resolve(res)
        }
      })
    })

    expect(res.status).toBe(200)
    expect(res.text).toBe('Partially consumed')
  })

  it('Should return 200 response - POST /partially-consumed-and-cancelled', async () => {
    const buffer = Buffer.alloc(1) // A large buffer will not make the test go far, so keep it small because it won't go far.
    const res = await new Promise<any>((resolve, reject) => {
      const req = request(server)
        .post('/partially-consumed-and-cancelled')
        .set('Content-Length', buffer.length.toString())

      req.write(buffer)
      req.end((err, res) => {
        if (err) {
          reject(err)
        } else {
          resolve(res)
        }
      })
    })

    expect(res.status).toBe(200)
    expect(res.text).toBe('Partially consumed and cancelled')
  })

  it('Should return 201 response - DELETE /posts/123', async () => {
    const res = await request(server).delete('/posts/123')
    expect(res.status).toBe(200)
    expect(res.text).toBe('DELETE 123')
  })

  it('Should return 500 response - GET /invalid', async () => {
    const res = await request(server).get('/invalid')
    expect(res.status).toBe(500)
    expect(res.headers['content-type']).toEqual('text/plain')
  })

  it('Should return 200 response - GET /ponyfill', async () => {
    const res = await request(server).get('/ponyfill')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Pony')
  })

  it('Should not raise error for TRACE method', async () => {
    const res = await request(server).trace('/')
    expect(res.text).toBe('headers: {}')
  })
})

describe('various response body types', () => {
  const runner = (Response: typeof GlobalResponse) => {
    const largeText = 'a'.repeat(1024 * 1024 * 10)
    let server: ServerType
    let resolveReadableStreamPromise: () => void
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
      app.get('/buffer', () => {
        const response = new Response(Buffer.from('Hello Hono!'), {
          headers: { 'content-type': 'text/plain' },
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
      const res = await request(server).get('/')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('text/plain')
      expect(res.headers['content-length']).toMatch('12')
      expect(res.text).toBe('Hello! Node!')
    })

    it('Should return 200 response - GET /large', async () => {
      const res = await request(server).get('/large')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('text/plain')
      expect(res.headers['content-length']).toMatch(largeText.length.toString())
      expect(res.text).toBe(largeText)
    })

    it('Should return 200 response - GET /uint8array', async () => {
      const res = await request(server).get('/uint8array')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('application/octet-stream')
      expect(res.headers['content-length']).toMatch('3')
      expect(res.body).toEqual(Buffer.from([1, 2, 3]))
    })

    it('Should return 200 response - GET /blob', async () => {
      const res = await request(server).get('/blob')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('application/octet-stream')
      expect(res.headers['content-length']).toMatch('3')
      expect(res.body).toEqual(Buffer.from([1, 2, 3]))
    })

    it('Should return 200 response - GET /readable-stream', async () => {
      const expectedChunks = ['Hello!', ' Node!']
      const resPromise = request(server)
        .get('/readable-stream')
        .parse((res, fn) => {
          // response header should be sent before sending data.
          expect(res.headers['transfer-encoding']).toBe('chunked')
          resolveReadableStreamPromise()

          res.on('data', (chunk) => {
            const str = chunk.toString()
            expect(str).toBe(expectedChunks.shift())
          })
          res.on('end', () => fn(null, ''))
        })
      await new Promise((resolve) => setTimeout(resolve, 100))
      const res = await resPromise
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('text/plain; charset=UTF-8')
      expect(res.headers['content-length']).toBeUndefined()
      expect(expectedChunks.length).toBe(0) // all chunks are received
    })

    it('Should return 200 response - GET /buffer', async () => {
      const res = await request(server).get('/buffer')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('text/plain')
      expect(res.headers['content-length']).toMatch('11')
      expect(res.text).toBe('Hello Hono!')
    })

    it('Should return 200 response - GET /etag/buffer', async () => {
      const res = await request(server).get('/etag/buffer')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('text/plain')
      expect(res.headers['etag']).toMatch('"7e03b9b8ed6156932691d111c81c34c3c02912f9"')
      expect(res.headers['content-length']).toMatch('11')
      expect(res.text).toBe('Hello Hono!')
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
      let res = await request(server).get('/book')
      expect(res.status).toBe(200)
      expect(res.text).toBe('get /book')

      res = await request(server).get('/book/123')
      expect(res.status).toBe(200)
      expect(res.text).toBe('get /book/123')

      res = await request(server).post('/book')
      expect(res.status).toBe(200)
      expect(res.text).toBe('post /book')
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
      let res = await request(server).get('/chained/abc')
      expect(res.status).toBe(200)
      expect(res.text).toBe('GET for abc')

      res = await request(server).post('/chained/abc')
      expect(res.status).toBe(200)
      expect(res.text).toBe('POST for abc')

      res = await request(server).put('/chained/abc')
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
    const res = await request(server)
      .post('/json')
      .set('Content-Type', 'application/json')
      .send({ foo: 'bar' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
  })

  it('Should handle form body', async () => {
    // to be `application/x-www-form-urlencoded`
    const res = await request(server).post('/form').type('form').send({ foo: 'bar' })
    expect(res.status).toBe(200)
    expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
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
      const res = await request(server).get('/json')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('application/json')
      expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
    })

    it('Should return JSON body from /json-async', async () => {
      const res = await request(server).get('/json-async')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('application/json')
      expect(JSON.parse(res.text)).toEqual({ foo: 'async' })
    })

    it('Should return HTML', async () => {
      const res = await request(server).get('/html')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('text/html')
      expect(res.text).toBe('<h1>Hello!</h1>')
    })

    it('Should return HTML from /html-async', async () => {
      const res = await request(server).get('/html-async')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('text/html')
      expect(res.text).toBe('<h1>Hello!</h1>')
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
      const res = await request(server).get('/json-blob')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('application/json')
      expect(JSON.parse(res.text)).toEqual({ foo: 'blob' })
    })

    it('Should return JSON body from /json-buffer', async () => {
      const res = await request(server).get('/json-buffer')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch('application/json')
      expect(JSON.parse(res.text)).toEqual({ foo: 'buffer' })
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
    const res = await request(server).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['x-powered-by']).toBe('Hono')
    expect(res.headers['foo']).toBe('bar')
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
    const res = await request(server).get('/')
    expect(res.status).toBe(404)
    expect(res.text).toBe('Custom NotFound')
  })

  it('Should return 500 response', async () => {
    const res = await request(server).get('/error')
    expect(res.status).toBe(500)
    expect(res.text).toBe('Custom Error!')
  })

  it('Should return 404 response - PURGE method', async () => {
    const res = await request(server).purge('/')
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
    const res = await request(server).get('/auth/a')
    expect(res.status).toBe(401)
    expect(res.text).toBe('Unauthorized')
  })

  it('Should authorized', async () => {
    const credential = Buffer.from(username + ':' + password).toString('base64')
    const res = await request(server).get('/auth/a').set('Authorization', `Basic ${credential}`)
    expect(res.status).toBe(200)
    expect(res.text).toBe('auth')
  })

  it('Should authorize Unicode', async () => {
    const credential = Buffer.from(username + ':' + unicodePassword).toString('base64')
    const res = await request(server)
      .get('/auth-unicode/a')
      .set('Authorization', `Basic ${credential}`)
    expect(res.status).toBe(200)
    expect(res.text).toBe('auth')
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
    const res = await request(server).get('/json')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toMatch('13')
    expect(res.headers['content-type']).toMatch('application/json')
    expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
  })

  it('Should return text body', async () => {
    const res = await request(server).get('/text')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toMatch('6')
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Hello!')
  })

  it('Should return JSON body - stream', async () => {
    const res = await request(server).get('/json-stream')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBeUndefined()
    expect(res.headers['content-type']).toMatch('application/json')
    expect(res.headers['transfer-encoding']).toMatch('chunked')
    expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
  })

  it('Should return text body - stream', async () => {
    const res = await request(server)
      .get('/stream')
      .parse((res, fn) => {
        const chunks: string[] = ['data: Hello!\n\n', 'data: end\n\n']
        let index = 0
        res.on('data', (chunk) => {
          const str = chunk.toString()
          expect(str).toBe(chunks[index++])
        })
        res.on('end', () => fn(null, ''))
      })
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBeUndefined()
    expect(res.headers['content-type']).toMatch('text/event-stream')
    expect(res.headers['transfer-encoding']).toMatch('chunked')
  })

  it('Should return error - stream without app crashing', async () => {
    const result = request(server).get('/error-stream')
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
    const res = await request(server).get('/').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /url', async () => {
    const res = await request(server).get('/url').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    const url = new URL(res.text)
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
    const res = await request(server, { http2: true }).get('/').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /headers', async () => {
    const res = await request(server, { http2: true }).get('/headers').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Hello! Node!')
  })

  // Use :authority as the host for the url.
  it('Should return 200 response - GET /url', async () => {
    const res = await request(server, { http2: true })
      .get('/url')
      .set(':scheme', 'https')
      .set(':authority', '127.0.0.1')
      .trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    const url = new URL(res.text)
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
    const res = await request(server).get('/one')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.headers['content-encoding']).toMatch('gzip')
  })

  it('should return 404 Custom NotFound', async () => {
    const server = createAdaptorServer(app)
    const res = await request(server).get('/err')
    expect(res.status).toBe(404)
    expect(res.text).toEqual('Custom NotFound')
    expect(res.headers['content-type']).toEqual('text/plain; charset=UTF-8')
    expect(res.headers['content-encoding']).toMatch('gzip')
  })

  it('should return 500 Custom Error!', async () => {
    const server = createAdaptorServer(app)
    const res = await request(server).get('/error')
    expect(res.status).toBe(500)
    expect(res.text).toEqual('Custom Error!')
    expect(res.headers['content-type']).toEqual('text/plain; charset=UTF-8')
    expect(res.headers['content-encoding']).toMatch('gzip')
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
    const res = await request(server).get('/one')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.headers['content-encoding']).toMatch('deflate')
  })

  it('should return 404 Custom NotFound', async () => {
    const server = createAdaptorServer(app)
    const res = await request(server).get('/err')
    expect(res.status).toBe(404)
    expect(res.text).toEqual('Custom NotFound')
    expect(res.headers['content-type']).toEqual('text/plain; charset=UTF-8')
    expect(res.headers['content-encoding']).toMatch('deflate')
  })

  it('should return 500 Custom Error!', async () => {
    const server = createAdaptorServer(app)
    const res = await request(server).get('/error')
    expect(res.status).toBe(500)
    expect(res.text).toEqual('Custom Error!')
    expect(res.headers['content-type']).toEqual('text/plain; charset=UTF-8')
    expect(res.headers['content-encoding']).toMatch('deflate')
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
    const res = await request(server).get('/json')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('application/json')
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
    const res = await request(server).get('/')

    expect(res.status).toBe(200)
    expect(res.body.incoming).toBe('IncomingMessage')
    expect(res.body.url).toBe('/')
    expect(res.body.outgoing).toBe('ServerResponse')
    expect(res.body.status).toBe(200)
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

  afterAll(() => {
    server.close()
  })

  it('Should not have memory leak - GET /', async () => {
    await request(server).get('/')
    global.gc?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(counter).toBe(0)
  })

  it('Should not have memory leak - POST /', async () => {
    await request(server).post('/').set('Content-Type', 'application/json').send({ foo: 'bar' })
    global.gc?.()
    await new Promise((resolve) => setTimeout(resolve, 10))
    expect(counter).toBe(0)
  })

  it('Should not have memory leak - GET /abort', async () => {
    const abortedPromise = new Promise<void>((resolve) => {
      onAbort = resolve
    })

    const req = request(server)
      .get('/abort')
      .end(() => {})
    await reqReadyPromise
    req.abort()
    await abortedPromise
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
