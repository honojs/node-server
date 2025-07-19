import fs from 'node:fs'
import { request as requestHTTP } from 'node:http'
import type { IncomingMessage } from 'node:http'
import { connect as connectHTTP2, createSecureServer as createHTTP2Server } from 'node:http2'
import type { ClientHttp2Session } from 'node:http2'
import { request as requestHTTPS, createServer as createHTTPSServer } from 'node:https'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server'
import type { ServerType } from '../src/types'
import { app } from './app'

const nodeVersionV20OrLater = parseInt(process.version.slice(1).split('.')[0]) >= 20

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

        callback(req as unknown as IncomingMessage)
        return req
      }) as unknown as typeof requestHTTP,
      true
    )
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
