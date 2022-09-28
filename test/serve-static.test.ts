import { createAdaptorServer } from './../src/server'
import { Hono } from 'hono'
import request from 'supertest'
import { serveStatic } from './../src/'

// Mock
// const store: Record<string, string> = {
//   'assets/static/plain.abcdef.txt': 'This is plain.txt',
//   'assets/static/hono.abcdef.html': '<h1>Hono!</h1>',
//   'assets/static/top/index.abcdef.html': '<h1>Top</h1>',
//   'static-no-root/plain.abcdef.txt': 'That is plain.txt',
//   'assets/static/options/foo.abcdef.txt': 'With options',
// }
// const manifest = JSON.stringify({
//   'assets/static/plain.txt': 'assets/static/plain.abcdef.txt',
//   'assets/static/hono.html': 'assets/static/hono.abcdef.html',
//   'assets/static/top/index.html': 'assets/static/top/index.abcdef.html',
//   'static-no-root/plain.txt': 'static-no-root/plain.abcdef.txt',
// })

describe('Serve Static Middleware', () => {
  const app = new Hono()

  app.use('/static/*', serveStatic({ root: './test/assets' }))
  app.use('/favicon.ico', serveStatic({ path: './test/assets/favicon.ico' }))

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
      id: '1',
      name: 'Foo Bar',
      isBot: 'true',
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
    expect(res.headers['content-type']).toBe('text/plain; charset=UTF-8')
    expect(res.text).toBe('404 Not Found')
  })
})
