import { Hono } from 'hono'
import { statSync } from 'node:fs'
import path from 'node:path'
import { sendFile } from './../src/send-file'
import { createAdaptorServer } from './../src/server'
import { requestServer } from './helpers/request'

describe('Send File Helper', () => {
  const server = createAdaptorServer(
    new Hono()
      // Registered with `.all()` (like `app.use(...)` in the serveStatic tests)
      // so HEAD/OPTIONS requests also reach `sendFile`.
      .all('/dynamic/*', (c) => {
        const requested = c.req.path.replace('/dynamic/', '')
        const filePath =
          requested === 'root'
            ? './test/assets/static/index.html'
            : `./test/assets/static/${requested}`
        return sendFile(c, filePath)
      })
      .get('/with-root/:name', (c) => {
        return sendFile(c, c.req.param('name'), { root: './test/assets/static' })
      })
      .get('/with-on-found/:name', (c) => {
        return sendFile(c, `./test/assets/static/${c.req.param('name')}`, {
          onFound: (path, c) => {
            c.header('X-Custom', `Found the file at ${path}`)
          },
        })
      })
      .get('/with-on-not-found', (c) => {
        return sendFile(c, './test/assets/static/does-not-exist.html', {
          onNotFound: (path, c) => {
            return c.text(`${path} is not found`, 404)
          },
        })
      })
      .get('/directory', (c) => {
        return sendFile(c, './test/assets/static')
      })
      .get('/directory-with-index', (c) => {
        return sendFile(c, './test/assets/static', { index: 'plain.txt' })
      })
      .get('/precompressed', (c) => {
        return sendFile(c, './test/assets/static-with-precompressed/hello.txt', {
          precompressed: true,
        })
      })
  )

  it('Should return the file with correct headers and data', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/dynamic/plain.txt' })
    const stats = statSync(path.join(__dirname, 'assets', 'static', 'plain.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-length')).toBe('17')
    expect(res.headers.get('last-modified')).toBe(stats.mtime.toUTCString())
    expect(await res.text()).toBe('This is plain.txt')
  })

  it('Should return the HTML file at the given path', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/dynamic/root' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toBe('<h1>Hello Hono</h1>')
  })

  it('Should return correct headers and data for json files', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/dynamic/data.json' })
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({
      id: 1,
      name: 'Foo Bar',
      flag: true,
    })
    expect(res.headers.get('content-type')).toBe('application/json')
  })

  it('Should resolve the path with the root option', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/with-root/plain.txt' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('This is plain.txt')
  })

  it('Should return the Not Found Response of the Context for non-existent files', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/dynamic/does-not-exist.txt' })
    expect(res.status).toBe(404)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=UTF-8')
    expect(await res.text()).toBe('404 Not Found')
  })

  it('Should use the custom notFound handler of the app', async () => {
    const app = new Hono()
    app.get('/file', (c) => sendFile(c, './test/assets/static/does-not-exist.txt'))
    app.notFound((c) => c.text('Custom Not Found', 404))
    const customServer = createAdaptorServer(app)

    const res = await requestServer(customServer, { method: 'GET', path: '/file' })
    expect(res.status).toBe(404)
    expect(await res.text()).toBe('Custom Not Found')

    await new Promise<void>((resolve) => customServer.close(() => resolve()))
  })

  it('Should return the Response from onNotFound if provided', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/with-on-not-found' })
    expect(res.status).toBe(404)
    expect(await res.text()).toMatch(/does-not-exist\.html is not found/)
  })

  it('Should call onFound with the resolved path', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/with-on-found/plain.txt' })
    expect(res.status).toBe(200)
    expect(res.headers.get('x-custom')).toMatch(
      /Found the file at test[\/\\]assets[\/\\]static[\/\\]plain\.txt$/
    )
    expect(await res.text()).toBe('This is plain.txt')
  })

  it('Should return 200 response to HEAD request', async () => {
    const res = await requestServer(server, { method: 'HEAD', path: '/dynamic/plain.txt' })
    const stats = statSync(path.join(__dirname, 'assets', 'static', 'plain.txt'))
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-length')).toBe('17')
    expect(res.headers.get('last-modified')).toBe(stats.mtime.toUTCString())
    expect(res.body).toBeNull()
  })

  it('Should return 200 response to OPTIONS request', async () => {
    // The `requestServer` helper cannot read a bodiless response, so check the
    // `Response` directly.
    const app = new Hono().options('/file', (c) => sendFile(c, './test/assets/static/plain.txt'))
    const res = await app.request('/file', { method: 'OPTIONS' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(res.headers.get('content-length')).toBe('17')
    expect(res.body).toBeNull()
  })

  it('Should serve the index file specified with the index option for a directory', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/directory-with-index' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/plain; charset=utf-8')
    expect(await res.text()).toBe('This is plain.txt')
  })

  it('Should return 404 for a directory without an index file', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/dynamic/admin' })
    expect(res.status).toBe(404)
  })

  it('Should return index.html for a directory by default', async () => {
    const res = await requestServer(server, { method: 'GET', path: '/directory' })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-type')).toBe('text/html; charset=utf-8')
    expect(await res.text()).toBe('<h1>Hello Hono</h1>')
  })

  it('Should serve precompressed files based on Accept-Encoding', async () => {
    const res = await requestServer(server, {
      method: 'GET',
      path: '/precompressed',
      headers: { 'accept-encoding': 'br' },
    })
    expect(res.status).toBe(200)
    expect(res.headers.get('content-encoding')).toBe('br')
    expect(res.headers.get('vary')).toBe('Accept-Encoding')
    expect(await res.text()).toBe('Hello br Compressed')
  })

  describe('Range requests', () => {
    it('Should return correct headers and data with range headers', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: '0-9' },
      })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-length')).toBe('10')
      expect(res.headers.get('content-range')).toBe('bytes 0-9/17')
      expect(await res.text()).toBe('This is pl')
    })

    it('Should return the remaining bytes with a range starting in the middle', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: '10-16' },
      })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe('bytes 10-16/17')
      expect(await res.text()).toBe('ain.txt')
    })

    it('Should handle a client range exceeding the data size', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: '0-20' },
      })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe('bytes 0-16/17')
      expect(await res.text()).toBe('This is plain.txt')
    })

    it('Should handle an invalid range header gracefully', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: 'hello' },
      })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe('bytes 0-16/17')
      expect(await res.text()).toBe('This is plain.txt')
    })

    it('Should return the last N bytes for a suffix range', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: 'bytes=-5' },
      })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe('bytes 12-16/17')
      expect(await res.text()).toBe('n.txt')
    })

    it('Should return the whole file for a suffix range exceeding the file size', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: 'bytes=-100' },
      })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe('bytes 0-16/17')
      expect(await res.text()).toBe('This is plain.txt')
    })

    it('Should return exactly 1 byte for range bytes=0-0', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: 'bytes=0-0' },
      })
      expect(res.status).toBe(206)
      expect(res.headers.get('content-range')).toBe('bytes 0-0/17')
      expect(await res.text()).toBe('T')
    })

    it('Should return 416 when the range start is beyond the end of the file', async () => {
      const res = await requestServer(server, {
        method: 'GET',
        path: '/dynamic/plain.txt',
        headers: { range: 'bytes=100-200' },
      })
      expect(res.status).toBe(416)
      expect(res.headers.get('content-range')).toBe('bytes */17')
    })
  })

  describe('Already finalized Context', () => {
    it('Should return the already set Response', async () => {
      const app = new Hono()
      app.get('/file', async (c, next) => {
        await next()
        return sendFile(c, './test/assets/static/plain.txt')
      })
      app.get('/file', (c) => c.text('Already set'))
      const finalizedServer = createAdaptorServer(app)

      // The first handler is only finalized after `next()` when it awaits the
      // response of the second, so `sendFile` sees a finalized Context.
      const res = await requestServer(finalizedServer, { method: 'GET', path: '/file' })
      expect(res.status).toBe(200)
      expect(await res.text()).toBe('Already set')

      await new Promise<void>((resolve) => finalizedServer.close(() => resolve()))
    })
  })

  describe('Type compatibility', () => {
    it('Should be returnable from handlers without PR #4012 style core type changes', async () => {
      // `sendFile` always returns a `Response`, so it satisfies the current
      // `HandlerResponse` type without requiring handlers to be allowed to
      // return middleware functions (honojs/hono#4012).
      const app = new Hono<{ Variables: { greet: string } }>()
        .use('/typed/*', async (c, next) => {
          c.set('greet', 'Hello')
          await next()
        })
        .get('/typed/:name', (c) => {
          const name = c.req.param('name')
          c.header('X-Greet', c.get('greet'))
          return sendFile(c, `./test/assets/static/${name}.txt`)
        })

      const typedServer = createAdaptorServer(app)
      const res = await requestServer(typedServer, { method: 'GET', path: '/typed/plain' })
      expect(res.status).toBe(200)
      expect(res.headers.get('x-greet')).toBe('Hello')
      expect(await res.text()).toBe('This is plain.txt')

      await new Promise<void>((resolve) => typedServer.close(() => resolve()))
    })
  })
})
