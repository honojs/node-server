import { Hono } from 'hono'
import { WebSocket, WebSocketServer } from 'ws'
import type { AddressInfo } from 'node:net'
import { createAdaptorServer, upgradeWebSocket } from '../src'

describe('WebSocket', () => {
  const startServer = (app: Hono) => {
    const wss = new WebSocketServer({ noServer: true })
    const server = createAdaptorServer({ fetch: app.fetch, websocket: { server: wss } })
    return new Promise<{ server: ReturnType<typeof createAdaptorServer>; address: AddressInfo }>(
      (resolve) => {
        server.listen(0, () => {
          resolve({ server, address: server.address() as AddressInfo })
        })
      }
    )
  }

  it('should connect with upgradeWebSocket without manual injection', async () => {
    const app = new Hono()

    app.get(
      '/ws',
      upgradeWebSocket(() => ({
        onMessage(event, ws) {
          ws.send(event.data as string)
        },
      }))
    )

    const { server, address } = await startServer(app)

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
      await new Promise<void>((resolve, reject) => {
        ws.once('open', () => {
          ws.send('hello')
        })
        ws.once('message', (data) => {
          expect(data.toString()).toBe('hello')
          resolve()
        })
        ws.once('error', reject)
      })
      ws.close()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('should reject WebSocket upgrade when route is not upgraded', async () => {
    const app = new Hono()
    app.get('/ws', (c) => c.text('ok'))

    const { server, address } = await startServer(app)

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
      await new Promise<void>((resolve, reject) => {
        ws.once('unexpected-response', (_, response) => {
          expect(response.statusCode).toBe(200)
          resolve()
        })
        ws.once('open', () => reject(new Error('WebSocket must not be upgraded')))
        ws.once('error', () => resolve())
      })
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('should forward response headers set by middleware on a successful upgrade', async () => {
    const app = new Hono()

    app.use(async (c, next) => {
      await next()
      c.header('x-auth-result', c.req.header('authorization') ? 'authorized' : 'missing')
    })
    app.get(
      '/ws',
      upgradeWebSocket(() => ({}))
    )

    const { server, address } = await startServer(app)

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`, {
        headers: {
          authorization: 'Bearer token',
        },
      })
      const responseHeaders = await new Promise<Record<string, string | string[] | undefined>>(
        (resolve, reject) => {
          ws.once('upgrade', (response) => {
            resolve(response.headers)
          })
          ws.once('error', reject)
        }
      )
      expect(responseHeaders['x-auth-result']).toBe('authorized')
      ws.close()
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('should forward response headers when the upgrade is rejected', async () => {
    const app = new Hono()

    app.get(
      '/ws',
      () =>
        new Response(null, {
          status: 401,
          headers: {
            'x-auth-result': 'missing',
          },
        })
    )

    const { server, address } = await startServer(app)

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/ws`)
      const responseHeaders = await new Promise<Record<string, string | string[] | undefined>>(
        (resolve, reject) => {
          ws.once('unexpected-response', (_, response) => {
            resolve(response.headers)
          })
          ws.once('open', () => reject(new Error('WebSocket must not be upgraded')))
        }
      )
      expect(responseHeaders['x-auth-result']).toBe('missing')
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })

  it('should not block other upgrade listeners', async () => {
    const app = new Hono()
    const { server, address } = await startServer(app)
    const wss = new WebSocketServer({ noServer: true })

    server.on('upgrade', (request, socket, head) => {
      if (request.url !== '/custom') {
        return
      }
      wss.handleUpgrade(request, socket, head, (ws) => {
        wss.emit('connection', ws, request)
      })
    })

    try {
      const ws = new WebSocket(`ws://127.0.0.1:${address.port}/custom`)
      await new Promise<void>((resolve, reject) => {
        ws.once('open', resolve)
        ws.once('error', reject)
      })
      ws.close()
    } finally {
      wss.close()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
