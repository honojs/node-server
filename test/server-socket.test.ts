import { Hono } from 'hono'
import { bodyLimit } from 'hono/body-limit'
import fs from 'node:fs'
import { request as requestHTTP } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { connect as connectHTTP2, createSecureServer as createHTTP2Server } from 'node:http2'
import type { ClientHttp2Session } from 'node:http2'
import { request as requestHTTPS, createServer as createHTTPSServer } from 'node:https'
import { connect as connectNet } from 'node:net'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server'
import type { ServerType } from '../src/types'
import { app } from './app'

const nodeVersionV20OrLater = parseInt(process.version.slice(1).split('.')[0]) >= 20

const createBodyLimitApp = () => {
  const app = new Hono()

  app.post(
    '/',
    bodyLimit({
      maxSize: 1024 * 1024,
      onError: (c) => c.text('Payload exceeded', 413),
    }),
    (c) => c.text('ok')
  )

  return app
}

describe('autoCleanupIncoming: true (default)', () => {
  let address: AddressInfo
  let server: ServerType
  let reqPromise: Promise<void>
  let reqClose: () => void
  let resPromise: Promise<void>
  let resClose: () => void

  const runner = (
    request: typeof requestHTTP | typeof requestHTTPS,
    expectEmptyBody: boolean = false
  ) => {
    it('Should return 200 response - GET /', async () => {
      let responseBody = ''
      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'GET',
          path: '/',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)
      req.end()

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe('Hello! Node!')
    })

    it('Should return 200 response - POST /posts', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/posts',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)

      req.write('')
      // no explicit end

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe('')
    })

    it('Should return 200 response - POST /body-consumed', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/body-consumed',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)

      req.write('Hello!')
      req.end() // this is normal request.

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe('Body length: 6')
    })

    it('Should return 200 response - POST /no-body-consumed', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/no-body-consumed',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)

      req.write(Buffer.alloc(10))
      // no explicit end

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe('No body consumed')
    })

    it('Should return 200 response - POST /body-cancelled', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/body-cancelled',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)

      req.write(Buffer.alloc(10))
      // no explicit end

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe('Body cancelled')
    })

    if (!nodeVersionV20OrLater) {
      it.skip('Skipped - Automatic cleanup with partially consumed pattern is not supported in v18. Skip test.', () => {})
      return
    }

    it('Should return 200 response - POST /partially-consumed', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/partially-consumed',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)
      req.on('error', () => {})

      req.write(Buffer.alloc(1024 * 1024 * 10))
      // no explicit end

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe(expectEmptyBody ? '' : 'Partially consumed')
    })

    it('Should return 200 response - POST /partially-consumed-and-cancelled', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/partially-consumed-and-cancelled',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)
      req.on('error', () => {})

      req.write(Buffer.alloc(1024 * 1024 * 10))
      // no explicit end

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe(expectEmptyBody ? '' : 'Partially consumed and cancelled')
    })

    it('Should return 413 response without ECONNRESET - POST /early-413', async () => {
      let responseBody = ''
      let responseStatus = 0
      let requestError: Error | null = null

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/early-413',
          rejectUnauthorized: false,
        },
        (res) => {
          responseStatus = res.statusCode ?? 0
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', () => {
            // For HTTP2, statusCode is set asynchronously via 'response' event
            if (!responseStatus) {
              responseStatus = res.statusCode ?? 0
            }
            resClose()
          })
        }
      )

      req.on('close', reqClose)
      req.on('error', (err) => {
        requestError = err
      })

      // Send large body slowly to simulate real network upload
      const chunkSize = 64 * 1024
      const totalSize = 1024 * 1024
      let offset = 0
      const sendChunk = () => {
        if (offset >= totalSize) {
          return
        }
        req.write(Buffer.alloc(Math.min(chunkSize, totalSize - offset)))
        offset += chunkSize
        setTimeout(sendChunk, 5)
      }
      sendChunk()

      await Promise.all([reqPromise, resPromise])
      expect(responseStatus).toBe(413)
      if (!expectEmptyBody) {
        expect(responseBody).toBe('Payload Too Large')
      }
      // Should not get ECONNRESET before receiving the response
      if (requestError) {
        expect((requestError as NodeJS.ErrnoException).code).not.toBe('ECONNRESET')
      }
    })
  }

  beforeEach(() => {
    reqPromise = new Promise((resolve) => {
      reqClose = resolve
    })
    resPromise = new Promise((resolve) => {
      resClose = resolve
    })
  })

  describe('http', () => {
    beforeAll(async () => {
      address = await new Promise((resolve) => {
        server = serve(
          {
            hostname: '127.0.0.1',
            fetch: app.fetch,
            port: 0,
          },
          (address) => {
            resolve(address)
          }
        )
      })
    })

    afterAll(() => {
      server.close()
    })

    runner(requestHTTP)
  })

  describe('https', () => {
    beforeAll(async () => {
      address = await new Promise((resolve) => {
        server = serve(
          {
            hostname: '127.0.0.1',
            fetch: app.fetch,
            port: 0,
            createServer: createHTTPSServer,
            serverOptions: {
              key: fs.readFileSync('test/fixtures/keys/agent1-key.pem'),
              cert: fs.readFileSync('test/fixtures/keys/agent1-cert.pem'),
            },
          },
          (address) => {
            resolve(address)
          }
        )
      })
    })

    afterAll(() => {
      server.close()
    })

    runner(requestHTTPS)
  })

  describe('http2', () => {
    let client: ClientHttp2Session
    beforeAll(async () => {
      address = await new Promise((resolve) => {
        server = serve(
          {
            hostname: '127.0.0.1',
            fetch: app.fetch,
            port: 0,
            createServer: createHTTP2Server,
            serverOptions: {
              key: fs.readFileSync('test/fixtures/keys/agent1-key.pem'),
              cert: fs.readFileSync('test/fixtures/keys/agent1-cert.pem'),
            },
          },
          (address) => {
            resolve(address)
          }
        )
      })
      client = connectHTTP2(`https://${address.address}:${address.port}`, {
        rejectUnauthorized: false,
      })
    })

    afterAll(() => {
      server.close()
    })

    // Reconnect HTTP2 client before each test to avoid session-level
    // flow control window exhaustion from previous tests
    beforeEach((done) => {
      if (!client.closed && !client.destroyed) {
        client.close(() => {
          client = connectHTTP2(`https://${address.address}:${address.port}`, {
            rejectUnauthorized: false,
          })
          client.once('connect', () => done())
        })
      } else {
        client = connectHTTP2(`https://${address.address}:${address.port}`, {
          rejectUnauthorized: false,
        })
        client.once('connect', () => done())
      }
    })

    runner(
      ((
        {
          method,
          path,
        }: {
          hostname: string
          port: number
          method: string
          path: string
        },
        callback: (req: IncomingMessage) => void
      ) => {
        const req = client.request({
          ':method': method,
          ':path': path,
        })

        req.on('response', (headers) => {
          ;(req as unknown as { statusCode: number | undefined }).statusCode = headers[':status']
        })
        callback(req as unknown as IncomingMessage)
        return req
      }) as unknown as typeof requestHTTP,
      true
    )
  })
})

describe('lingering close for early 413 responses', () => {
  let address: AddressInfo
  let server: ServerType

  beforeAll(async () => {
    const bodyLimitApp = createBodyLimitApp()
    address = await new Promise((resolve) => {
      server = serve(
        {
          hostname: '127.0.0.1',
          fetch: bodyLimitApp.fetch,
          port: 0,
        },
        (address) => {
          resolve(address)
        }
      )
    })
  })

  afterAll(() => {
    server.close()
  })

  it('Should keep HTTP/1 connection graceful after body-limit sends 413', async () => {
    const total = 50 * 1024 * 1024 + 1

    await new Promise<void>((resolve, reject) => {
      const socket = connectNet(address.port, address.address)
      let response = ''
      let saw413 = false
      let settled = false
      let writeTimer: ReturnType<typeof setInterval> | undefined
      let writesAfterResponse = 0
      let firstWriteAfterResponseSucceeded = false

      const finish = (error?: Error) => {
        if (settled) {
          return
        }
        settled = true
        if (writeTimer) {
          clearInterval(writeTimer)
        }
        socket.removeAllListeners()
        socket.destroy()
        if (error) {
          reject(error)
        } else {
          resolve()
        }
      }

      socket.on('connect', () => {
        socket.write(
          'POST / HTTP/1.1\r\n' +
            'Host: localhost\r\n' +
            `Content-Length: ${total}\r\n` +
            'Content-Type: text/plain\r\n' +
            '\r\n'
        )
        socket.write(Buffer.alloc(64 * 1024))
        writeTimer = setInterval(() => {
          if (socket.destroyed) {
            return
          }
          socket.write(Buffer.alloc(64 * 1024), (error) => {
            if (error) {
              finish(error)
              return
            }
            if (saw413) {
              writesAfterResponse += 1
              firstWriteAfterResponseSucceeded = true
              if (writesAfterResponse >= 4) {
                if (writeTimer) {
                  clearInterval(writeTimer)
                }
                socket.end()
              }
            }
          })
        }, 20)
      })

      socket.on('data', (chunk) => {
        response += chunk.toString()
        if (!saw413 && response.includes('413 Payload Too Large')) {
          saw413 = true
        }
      })

      socket.on('error', (error) => {
        finish(error)
      })

      socket.on('close', (hadError) => {
        if (hadError) {
          return
        }
        if (!saw413) {
          finish(new Error(`Expected 413 response, got: ${response}`))
          return
        }
        if (!firstWriteAfterResponseSucceeded) {
          finish(new Error('Expected at least one successful write after the 413 response.'))
          return
        }
        finish()
      })
    })
  })
})

describe('autoCleanupIncoming: false', () => {
  let address: AddressInfo
  let server: ServerType
  let reqPromise: Promise<void>
  let reqClose: () => void
  let resPromise: Promise<void>
  let resClose: () => void

  const runner = (request: typeof requestHTTP | typeof requestHTTPS) => {
    it('Should return 200 response - GET /', async () => {
      let responseBody = ''
      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'GET',
          path: '/',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)
      req.end()

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe('Hello! Node!')
    })

    it('Should return 200 response - POST /body-consumed', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/body-consumed',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)

      req.write('Hello!')
      req.end() // this is normal request.

      await Promise.all([reqPromise, resPromise])
      expect(responseBody).toBe('Body length: 6')
    })

    if (!nodeVersionV20OrLater) {
      it.skip('Skipped - The following features are also functional in v18, but the expected test results are different, so the tests are not run in v18', () => {})
      return
    }

    it('Should return 200 response - POST /no-body-consumed', async () => {
      let responseBody = ''

      const req = request(
        {
          hostname: address.address,
          port: address.port,
          method: 'POST',
          path: '/no-body-consumed',
          rejectUnauthorized: false,
        },
        (res) => {
          res.on('data', (chunk) => {
            responseBody += chunk.toString()
          })
          res.on('close', resClose)
        }
      )

      req.on('close', reqClose)

      req.write(Buffer.alloc(10))
      // no explicit end

      const result = await Promise.any([
        Promise.all([reqPromise, resPromise]),
        new Promise((resolve) => setTimeout(() => resolve('timeout'), 100)),
      ])
      expect(result).toBe('timeout')
      expect(responseBody).toBe('No body consumed')
    })
  }

  beforeEach(() => {
    reqPromise = new Promise((resolve) => {
      reqClose = resolve
    })
    resPromise = new Promise((resolve) => {
      resClose = resolve
    })
  })

  describe('http', () => {
    beforeAll(async () => {
      address = await new Promise((resolve) => {
        server = serve(
          {
            hostname: '127.0.0.1',
            fetch: app.fetch,
            port: 0,
            autoCleanupIncoming: false,
          },
          (address) => {
            resolve(address)
          }
        )
      })
    })

    afterAll(() => {
      server.close()
    })

    runner(requestHTTP)
  })

  describe('https', () => {
    beforeAll(async () => {
      address = await new Promise((resolve) => {
        server = serve(
          {
            hostname: '127.0.0.1',
            fetch: app.fetch,
            port: 0,
            autoCleanupIncoming: false,
            createServer: createHTTPSServer,
            serverOptions: {
              key: fs.readFileSync('test/fixtures/keys/agent1-key.pem'),
              cert: fs.readFileSync('test/fixtures/keys/agent1-cert.pem'),
            },
          },
          (address) => {
            resolve(address)
          }
        )
      })
    })

    afterAll(() => {
      server.close()
    })

    runner(requestHTTPS)
  })

  describe('http2', () => {
    let client: ClientHttp2Session
    beforeAll(async () => {
      address = await new Promise((resolve) => {
        server = serve(
          {
            hostname: '127.0.0.1',
            fetch: app.fetch,
            port: 0,
            autoCleanupIncoming: false,
            createServer: createHTTP2Server,
            serverOptions: {
              key: fs.readFileSync('test/fixtures/keys/agent1-key.pem'),
              cert: fs.readFileSync('test/fixtures/keys/agent1-cert.pem'),
            },
          },
          (address) => {
            resolve(address)
          }
        )
      })
      client = connectHTTP2(`https://${address.address}:${address.port}`, {
        rejectUnauthorized: false,
      })
    })

    afterAll(() => {
      server.close()
    })

    runner(((
      {
        method,
        path,
      }: {
        hostname: string
        port: number
        method: string
        path: string
      },
      callback: (req: IncomingMessage) => void
    ) => {
      const req = client.request({
        ':method': method,
        ':path': path,
      })

      callback(req as unknown as IncomingMessage)
      return req
    }) as unknown as typeof requestHTTP)
  })
})
