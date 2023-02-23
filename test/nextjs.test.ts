import request from 'supertest'
import { Hono } from 'hono'
import { handle } from '../src/nextjs'

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

  const server = handle(app)

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

    const server = handle(app)

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
  const server = handle(app)

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
  const server = handle(app)

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
