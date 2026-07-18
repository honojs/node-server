import { Hono } from 'hono'
import { createServer } from 'node:http'
import http from 'node:http'
import http2 from 'node:http2'
import { describe, it, expect, vi } from 'vitest'
import { writeEarlyHints, earlyHints } from '../src/early-hints'
import { getRequestListener } from '../src/listener'

describe('HTTP/1.1 Early Hints', () => {
  it('should send a 103 early hints response before the final response', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      const hintsWritten = writeEarlyHints(c, {
        link: '</style.css>; rel=preload; as=style',
      })
      expect(hintsWritten).toBe(true)
      return c.text('Hello Early Hints')
    })

    const server = createServer(getRequestListener(app.fetch))

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => {
        const address = server.address() as any
        const port = address.port

        const req = http.request({
          port,
          path: '/',
        }, (res) => {
          let body = ''
          res.on('data', chunk => body += chunk)
          res.on('end', () => {
            try {
              expect(res.statusCode).toBe(200)
              expect(body).toBe('Hello Early Hints')
              expect(earlyHintReceived).toBe(true)
              server.close(err => err ? reject(err) : resolve())
            } catch (err) {
              server.close()
              reject(err)
            }
          })
          res.on('error', (err) => {
            server.close()
            reject(err)
          })
        })

        let earlyHintReceived = false
        req.on('information', (info) => {
          try {
            expect(info.statusCode).toBe(103)
            expect(info.headers.link).toBe('</style.css>; rel=preload; as=style')
            earlyHintReceived = true
          } catch (err) {
            server.close()
            reject(err)
          }
        })

        req.on('error', (err) => {
          server.close()
          reject(err)
        })
        req.end()
      })
    })
  })

  it('should send early hints using middleware', async () => {
    const app = new Hono()
    app.use('*', earlyHints({
      link: ['</style.css>; rel=preload; as=style', '</script.js>; rel=preload; as=script'],
    }))
    app.get('/', (c) => c.text('Hello Middleware'))

    const server = createServer(getRequestListener(app.fetch))

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => {
        const address = server.address() as any
        const port = address.port

        const req = http.request({
          port,
          path: '/',
        }, (res) => {
          let body = ''
          res.on('data', chunk => body += chunk)
          res.on('end', () => {
            try {
              expect(res.statusCode).toBe(200)
              expect(body).toBe('Hello Middleware')
              expect(earlyHintReceived).toBe(true)
              server.close(err => err ? reject(err) : resolve())
            } catch (err) {
              server.close()
              reject(err)
            }
          })
          res.on('error', (err) => {
            server.close()
            reject(err)
          })
        })

        let earlyHintReceived = false
        req.on('information', (info) => {
          try {
            expect(info.statusCode).toBe(103)
            // In HTTP/1.x, multiple headers or array headers get combined into a single comma-separated string.
            expect(info.headers.link).toBe('</style.css>; rel=preload; as=style, </script.js>; rel=preload; as=script')
            earlyHintReceived = true
          } catch (err) {
            server.close()
            reject(err)
          }
        })

        req.on('error', (err) => {
          server.close()
          reject(err)
        })
        req.end()
      })
    })
  })

  it('should return false if writeEarlyHints is absent on the outgoing message', () => {
    const mockCtx = {
      env: {
        outgoing: {
          headersSent: false,
        }
      }
    } as any

    const result = writeEarlyHints(mockCtx, { link: '/style.css' })
    expect(result).toBe(false)
  })

  it('should return false if headers are already sent', () => {
    const mockCtx = {
      env: {
        outgoing: {
          writeEarlyHints: vi.fn(),
          headersSent: true,
        }
      }
    } as any

    const result = writeEarlyHints(mockCtx, { link: '/style.css' })
    expect(result).toBe(false)
    expect(mockCtx.env.outgoing.writeEarlyHints).not.toHaveBeenCalled()
  })
})

describe('HTTP/2 Early Hints', () => {
  it('should send a 103 early hints response before the final response over HTTP/2', async () => {
    const app = new Hono()
    app.get('/', (c) => {
      const hintsWritten = writeEarlyHints(c, {
        link: '</style.css>; rel=preload; as=style',
      })
      expect(hintsWritten).toBe(true)
      return c.text('Hello HTTP2 Early Hints')
    })

    const server = http2.createServer(getRequestListener(app.fetch))

    await new Promise<void>((resolve, reject) => {
      server.listen(0, () => {
        const address = server.address() as any
        const port = address.port

        const client = http2.connect(`http://localhost:${port}`)
        const req = client.request({ ':path': '/' })

        let earlyHintReceived = false
        req.on('headers', (headers) => {
          try {
            if (headers[':status'] === 103) {
              expect(headers.link).toBe('</style.css>; rel=preload; as=style')
              earlyHintReceived = true
            }
          } catch (err) {
            client.close()
            server.close()
            reject(err)
          }
        })

        let finalResponseReceived = false
        req.on('response', (headers) => {
          try {
            expect(headers[':status']).toBe(200)
            finalResponseReceived = true
          } catch (err) {
            client.close()
            server.close()
            reject(err)
          }
        })

        let body = ''
        req.on('data', chunk => body += chunk)

        req.on('end', () => {
          try {
            expect(earlyHintReceived).toBe(true)
            expect(finalResponseReceived).toBe(true)
            expect(body).toBe('Hello HTTP2 Early Hints')
            client.close()
            server.close(err => err ? reject(err) : resolve())
          } catch (err) {
            client.close()
            server.close()
            reject(err)
          }
        })

        req.on('error', (err) => {
          client.close()
          server.close()
          reject(err)
        })
      })
    })
  })
})
