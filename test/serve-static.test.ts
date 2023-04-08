import { createAdaptorServer } from './../src/server'
import { Hono } from 'hono'
import request from 'supertest'
import { serveStatic } from './../src/serve-static'

describe('Serve Static Middleware', () => {
  const app = new Hono()

  app.use('/static/*', serveStatic({ root: './test/assets' }))
  app.use('/favicon.ico', serveStatic({ path: './test/assets/favicon.ico' }))
  app.use(
    '/dot-static/*',
    serveStatic({
      root: './test/assets',
      rewriteRequestPath: (path) => path.replace(/^\/dot-static/, '/.static'),
    })
  )

  const server = createAdaptorServer(app)

  it('Should return index.html', async () => {
    const res = await request(server).get('/static/')
    expect(res.status).toBe(200)
    expect(res.text).toBe('<h1>Hello Hono</h1>')
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
  })

  it('Should return hono.html', async () => {
    const res = await request(server).get('/static/hono.html')
    expect(res.status).toBe(200)
    expect(res.text).toBe('<h1>This is Hono.html</h1>')
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
  })

  it('Should return correct headers for icons', async () => {
    const res = await request(server).get('/favicon.ico')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('image/x-icon')
  })

  it('Should return correct headers and data for json files', async () => {
    const res = await request(server).get('/static/data.json')
    expect(res.status).toBe(200)
    expect(res.body).toEqual({
      id: 1,
      name: 'Foo Bar',
      flag: true,
    })
    expect(res.headers['content-type']).toBe('application/json; charset=utf-8')
  })

  it('Should return correct headers and data for text', async () => {
    const res = await request(server).get('/static/plain.txt')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.text).toBe('This is plain.txt')
  })

  it('Should return 404 for non-existent files', async () => {
    const res = await request(server).get('/static/does-not-exist.html')
    expect(res.status).toBe(404)
    expect(res.headers['content-type']).toBe('text/plain;charset=UTF-8')
    expect(res.text).toBe('404 Not Found')
  })

  it('Should return 200 with rewriteRequestPath', async () => {
    const res = await request(server).get('/dot-static/plain.txt')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.text).toBe('This is plain.txt')
  })

  it('Should return 404 with rewriteRequestPath', async () => {
    const res = await request(server).get('/dot-static/does-no-exists.txt')
    expect(res.status).toBe(404)
  })
})
