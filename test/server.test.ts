import { createAdaptorServer } from '../src/server'
import request from 'supertest'
import { Hono } from 'hono'
import { poweredBy } from 'hono/powered-by'
import { basicAuth } from 'hono/basic-auth'

describe('Basic', () => {
  const app = new Hono()
  app.get('/', (c) => c.text('Hello! Node!'))

  app.get('/posts', (c) => {
    return c.text(`Page ${c.req.query('page')}`)
  })
  app.post('/posts', (c) => {
    return c.redirect('/posts')
  })
  app.delete('/posts/:id', (c) => {
    return c.text(`DELETE ${c.req.param('id')}`)
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

  it('Should return 302 response - POST /posts', async () => {
    const res = await request(server).post('/posts')
    expect(res.status).toBe(302)
    expect(res.headers['location']).toBe('/posts')
  })

  it('Should return 201 response - DELETE /posts/123', async () => {
    const res = await request(server).delete('/posts/123')
    expect(res.status).toBe(200)
    expect(res.text).toBe(`DELETE 123`)
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
      expect(res.text).toBe(`get /book`)

      res = await request(server).get('/book/123')
      expect(res.status).toBe(200)
      expect(res.text).toBe(`get /book/123`)

      res = await request(server).post('/book')
      expect(res.status).toBe(200)
      expect(res.text).toBe(`post /book`)
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
      expect(res.text).toBe(`GET for abc`)

      res = await request(server).post('/chained/abc')
      expect(res.status).toBe(200)
      expect(res.text).toBe(`POST for abc`)

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
  const app = new Hono()
  app.get('/json', (c) => {
    return c.json({ foo: 'bar' })
  })
  app.get('/html', (c) => {
    return c.html('<h1>Hello!</h1>')
  })
  const server = createAdaptorServer(app)

  it('Should return JSON body', async () => {
    const res = await request(server).get('/json')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/application\/json/)
    expect(JSON.parse(res.text)).toEqual({ foo: 'bar' })
  })

  it('Should return HTML', async () => {
    const res = await request(server).get('/html')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/html/)
    expect(res.text).toBe('<h1>Hello!</h1>')
  })
})

describe('Middleware', () => {
  const app = new Hono()
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
