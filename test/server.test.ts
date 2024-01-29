import fs from 'node:fs'
import { createServer as createHttp2Server } from 'node:http2'
import { createServer as createHTTPSServer } from 'node:https'
import { Response as PonyfillResponse } from '@whatwg-node/fetch'
import { Hono } from 'hono'
import { basicAuth } from 'hono/basic-auth'
import { compress } from 'hono/compress'
import { poweredBy } from 'hono/powered-by'
import request from 'supertest'
import { createAdaptorServer } from '../src/server'
import type { HttpBindings } from '../src/types'

describe('Basic', () => {
  const app = new Hono()
  app.get('/', (c) => c.text('Hello! Node!'))

  app.get('/posts', (c) => {
    return c.text(`Page ${c.req.query('page')}`)
  })
  app.get('/user-agent', (c) => {
    return c.text(c.req.header('user-agent') as string)
  })
  app.post('/posts', (c) => {
    return c.redirect('/posts')
  })
  app.delete('/posts/:id', (c) => {
    return c.text(`DELETE ${c.req.param('id')}`)
  })
  // @ts-expect-error the response is string
  app.get('/invalid', () => {
    return '<h1>HTML</h1>'
  })
  app.get('/ponyfill', () => {
    return new PonyfillResponse('Pony')
  })

  const server = createAdaptorServer(app)

  it('Should return 200 response - GET /', async () => {
    const res = await request(server).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /posts?page=2', async () => {
    const res = await request(server).get('/posts?page=2')
    expect(res.status).toBe(200)
    expect(res.text).toBe('Page 2')
  })

  it('Should return 200 response - GET /user-agent', async () => {
    const res = await request(server).get('/user-agent').set('user-agent', 'Hono')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Hono')
  })

  it('Should return 302 response - POST /posts', async () => {
    const res = await request(server).post('/posts')
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('/posts')
  })

  it('Should return 201 response - DELETE /posts/123', async () => {
    const res = await request(server).delete('/posts/123')
    expect(res.status).toBe(200)
    expect(res.text).toBe('DELETE 123')
  })

  it('Should return 500 response - GET /invalid', async () => {
    const res = await request(server).get('/invalid')
    expect(res.status).toBe(500)
    expect(res.headers['content-type']).toBe('text/plain')
  })

  it('Should return 200 response - GET /ponyfill', async () => {
    const res = await request(server).get('/ponyfill')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Pony')
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
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
    })

    it('Should return JSON body from /json-async', async () => {
      const res = await request(server).get('/json-async')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(JSON.parse(res.text)).toEqual({ foo: 'async' })
    })

    it('Should return HTML', async () => {
      const res = await request(server).get('/html')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
      expect(res.text).toBe('<h1>Hello!</h1>')
    })

    it('Should return HTML from /html-async', async () => {
      const res = await request(server).get('/html-async')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/text\/html/)
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
      expect(res.headers['content-type']).toMatch(/application\/json/)
      expect(JSON.parse(res.text)).toEqual({ foo: 'blob' })
    })

    it('Should return JSON body from /json-buffer', async () => {
      const res = await request(server).get('/json-buffer')
      expect(res.status).toBe(200)
      expect(res.headers['content-type']).toMatch(/application\/json/)
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

  it('Should return 500 response - PURGE method', async () => {
    const res = await request(server).purge('/')
    expect(res.status).toBe(500)
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
    return c.stream(async (stream) => {
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
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
  })

  it('Should return text body', async () => {
    const res = await request(server).get('/text')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toMatch('6')
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Hello!')
  })

  it('Should return JSON body - stream', async () => {
    const res = await request(server).get('/json-stream')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBeUndefined()
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(res.headers['transfer-encoding']).toMatch(/chunked/)
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
    expect(res.headers['content-type']).toMatch(/text\/event-stream/)
    expect(res.headers['transfer-encoding']).toMatch(/chunked/)
  })

  it('Should return error - stream without app crashing', async () => {
    const result = request(server).get('/error-stream')
    await expect(result).rejects.toThrow('aborted')
  })
})

describe('SSL', () => {
  const app = new Hono()
  app.get('/', (c) => c.text('Hello! Node!'))

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
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Hello! Node!')
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
    // @ts-expect-error: @types/supertest is not updated yet
    const res = await request(server, { http2: true }).get('/').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Hello! Node!')
  })

  it('Should return 200 response - GET /headers', async () => {
    // @ts-expect-error: @types/supertest is not updated yet
    const res = await request(server, { http2: true }).get('/headers').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Hello! Node!')
  })

  // Use :authority as the host for the url.
  it('Should return 200 response - GET /url', async () => {
    // @ts-expect-error: @types/supertest is not updated yet
    const res = await request(server, { http2: true }).get('/url').trustLocalhost()
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(new URL(res.text).hostname).toBe('127.0.0.1')
  })
})

describe('Hono compression', () => {
  const app = new Hono()
  app.use('*', compress())

  app.get('/one', async (c) => {
    let body = 'one'

    for (let index = 0; index < 1000 * 1000; index++) {
      body += ' one'
    }
    return c.text(body)
  })

  it('Should return 200 response - GET /one', async () => {
    const server = createAdaptorServer(app)
    const res = await request(server).get('/one')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.headers['content-encoding']).toMatch(/gzip/)
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
    expect(res.headers['content-type']).toMatch(/application\/json/)
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
