import { Hono } from 'hono'
import request from 'supertest'
import { serveStatic } from './../src/serve-static'
import { createAdaptorServer } from './../src/server'

describe('Serve Static Middleware', () => {
  const app = new Hono()

  app.use(
    '/static/*',
    serveStatic({
      root: './test/assets',
      onFound: (path, c) => {
        c.header('X-Custom', `Found the file at ${path}`)
      },
    })
  )
  app.use('/favicon.ico', serveStatic({ path: './test/assets/favicon.ico' }))
  app.use(
    '/dot-static/*',
    serveStatic({
      root: './test/assets',
      rewriteRequestPath: (path) => path.replace(/^\/dot-static/, '/.static'),
    })
  )

  let notFoundMessage = ''
  app.use(
    '/on-not-found/*',
    serveStatic({
      root: './not-found',
      onNotFound: (path, c) => {
        notFoundMessage = `${path} is not found, request to ${c.req.path}`
      },
    })
  )

  app.use(
    '/static-with-precompressed/*',
    serveStatic({
      root: './test/assets',
      precompressed: true,
    })
  )

  const server = createAdaptorServer(app)

  it('Should return index.html', async () => {
    const res = await request(server).get('/static/')
    expect(res.status).toBe(200)
    expect(res.text).toBe('<h1>Hello Hono</h1>')
    expect(res.headers['content-type']).toBe('text/html; charset=utf-8')
    expect(res.headers['x-custom']).toBe('Found the file at ./test/assets/static/index.html')
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
    expect(res.headers['content-type']).toBe('text/plain; charset=UTF-8')
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

  it('Should return 200 response to HEAD request', async () => {
    const res = await request(server).head('/static/plain.txt')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['content-length']).toBe('17')
    expect(res.text).toBe(undefined)
  })

  it('Should return correct headers and data with range headers', async () => {
    let res = await request(server).get('/static/plain.txt').set('range', '0-9')
    expect(res.status).toBe(206)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['content-length']).toBe('10')
    expect(res.headers['content-range']).toBe('bytes 0-9/17')
    expect(res.text.length).toBe(10)
    expect(res.text).toBe('This is pl')

    res = await request(server).get('/static/plain.txt').set('range', '10-16')
    expect(res.status).toBe(206)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['content-length']).toBe('7')
    expect(res.headers['content-range']).toBe('bytes 10-16/17')
    expect(res.text.length).toBe(7)
    expect(res.text).toBe('ain.txt')
  })

  it('Should return correct headers and data if client range exceeds the data size', async () => {
    const res = await request(server).get('/static/plain.txt').set('range', '0-20')
    expect(res.status).toBe(206)
    expect(res.headers['content-type']).toBe('text/plain; charset=utf-8')
    expect(res.headers['content-length']).toBe('17')
    expect(res.headers['content-range']).toBe('bytes 0-16/17')
    expect(res.text.length).toBe(17)
    expect(res.text).toBe('This is plain.txt')
  })

  it('Should handle the `onNotFound` option', async () => {
    const res = await request(server).get('/on-not-found/foo.txt')
    expect(res.status).toBe(404)
    expect(notFoundMessage).toBe(
      './not-found/on-not-found/foo.txt is not found, request to /on-not-found/foo.txt'
    )
  })

  it('Should handle double dots in URL', async () => {
    const res = await request(server).get('/static/../secret.txt')
    expect(res.status).toBe(404)
  })

  it('Should handle an extension less files', async () => {
    const res = await request(server).get('/static/extensionless')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toBe('application/octet-stream')
    expect(res.body.toString()).toBe('Extensionless')
  })

  it('Should return a pre-compressed zstd response - /static-with-precompressed/hello.txt', async () => {
    // Check if it returns a normal response
    let res = await request(server).get('/static-with-precompressed/hello.txt')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBe('20')
    expect(res.text).toBe('Hello Not Compressed')

    res = await request(server)
      .get('/static-with-precompressed/hello.txt')
      .set('Accept-Encoding', 'zstd')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBe('21')
    expect(res.headers['content-encoding']).toBe('zstd')
    expect(res.headers['vary']).toBe('Accept-Encoding')
    expect(res.text).toBe('Hello zstd Compressed')
  })

  it('Should return a pre-compressed brotli response - /static-with-precompressed/hello.txt', async () => {
    const res = await request(server)
      .get('/static-with-precompressed/hello.txt')
      .set('Accept-Encoding', 'wompwomp, gzip, br, deflate, zstd')
    expect(res.status).toBe(200)
    expect(res.headers['content-length']).toBe('19')
    expect(res.headers['content-encoding']).toBe('br')
    expect(res.headers['vary']).toBe('Accept-Encoding')
    expect(res.text).toBe('Hello br Compressed')
  })

  it('Should not return a pre-compressed response - /static-with-precompressed/hello.txt', async () => {
    const res = await request(server)
      .get('/static-with-precompressed/hello.txt')
      .set('Accept-Encoding', 'wompwomp, unknown')
    expect(res.status).toBe(200)
    expect(res.headers['content-encoding']).toBeUndefined()
    expect(res.headers['vary']).toBeUndefined()
    expect(res.text).toBe('Hello Not Compressed')
  })
})
