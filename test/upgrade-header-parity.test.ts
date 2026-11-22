import { Hono } from 'hono'
import { WebSocket, WebSocketServer } from 'ws'
import { connect } from 'node:net'
import type { AddressInfo } from 'node:net'
import { createAdaptorServer, upgradeWebSocket } from '../src'

describe('HTTP and WebSocket request headers', () => {
  it('preserves raw duplicate headers through the upgrade Request and authentication', async () => {
    const app = new Hono()
    const wss = new WebSocketServer({ noServer: true })
    let observed: Record<string, string | undefined> = {}
    app.use('*', async (c, next) => {
      observed = Object.fromEntries(
        ['authorization', 'cookie', 'origin', 'host', 'x-example'].map((name) => [
          name,
          c.req.header(name),
        ])
      )
      if (observed.authorization !== 'Bearer alpha') return c.text('denied', 401)
      await next()
    })
    const upgrade = upgradeWebSocket(() => ({
      onMessage(event, ws) {
        ws.send(`echo:${event.data}`)
      },
    }))
    app.get('/', async (c, next) => {
      if (c.req.header('upgrade') === 'websocket') {
        await upgrade(c, next)
        return c.res
      }
      return c.text('ok')
    })
    const server = createAdaptorServer({ fetch: app.fetch, websocket: { server: wss } })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const port = (server.address() as AddressInfo).port
    const send = (auth: string[], isUpgrade: boolean) =>
      new Promise<number>((resolve, reject) => {
        const socket = connect(port, '127.0.0.1', () =>
          socket.write(
            'GET / HTTP/1.1\r\nHost: example.test\r\n' +
              auth.map((v) => `Authorization: ${v}\r\n`).join('') +
              'Cookie: a=1\r\nCookie: b=2\r\nOrigin: https://one.test\r\nOrigin: https://two.test\r\nX-Example: one\r\nX-Example: two\r\n' +
              (isUpgrade
                ? 'Connection: Upgrade\r\nUpgrade: websocket\r\nSec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==\r\nSec-WebSocket-Version: 13\r\n'
                : 'Connection: close\r\n') +
              '\r\n'
          )
        )
        let data = ''
        socket.setTimeout(3000, () => socket.destroy(new Error('timeout')))
        socket.on('data', (chunk) => {
          data += chunk.toString()
          if (data.includes('\r\n\r\n')) {
            const status = Number(data.match(/^HTTP\/1.1 (\d+)/)?.[1])
            socket.destroy()
            resolve(status)
          }
        })
        socket.on('error', reject)
      })
    try {
      for (const auth of [
        ['Bearer alpha'],
        ['Bearer beta'],
        ['Bearer alpha', 'Bearer beta'],
        ['Bearer beta', 'Bearer alpha'],
      ]) {
        for (const mode of ['http', 'upgrade']) {
          const expectedHeaders = {
            authorization: auth.join(', '),
            cookie: 'a=1; b=2',
            origin: 'https://one.test, https://two.test',
            host: 'example.test',
            'x-example': 'one, two',
          }
          const expectedStatus =
            auth.join(', ') === 'Bearer alpha' ? (mode === 'upgrade' ? 101 : 200) : 401
          const status = await send(auth, mode === 'upgrade')
          const caseName = `${mode}: ${auth.join(', ')}`
          expect.soft(observed, caseName).toEqual(expectedHeaders)
          expect.soft(status, caseName).toBe(expectedStatus)
        }
      }
      const client = new WebSocket(`ws://127.0.0.1:${port}/`, {
        headers: { Authorization: 'Bearer alpha' },
      })
      const reply = await new Promise<string>((resolve, reject) => {
        client.on('open', () => client.send('hello'))
        client.on('message', (data) => resolve(data.toString()))
        client.on('error', reject)
      })
      expect(reply).toBe('echo:hello')
      client.close()
      await new Promise<void>((resolve) => client.once('close', () => resolve()))
    } finally {
      for (const client of wss.clients) client.terminate()
      await new Promise<void>((resolve) => server.close(() => resolve()))
    }
  })
})
