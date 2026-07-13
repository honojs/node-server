import type { Context } from 'hono'
import { Hono } from 'hono'
import { request as requestHTTP } from 'node:http'
import type { ClientRequest, OutgoingHttpHeaders } from 'node:http'
import type { AddressInfo } from 'node:net'
import { serve } from '../src/server'
import type { HttpBindings, ServerType } from '../src/types'

type BodyReadResult = { body: unknown } | { error: unknown }
type BindingsContext = Context<{ Bindings: HttpBindings }>

const closeServer = (server: ServerType): Promise<void> =>
  new Promise((resolve, reject) => {
    server.close((error?: Error) => {
      if (error) {
        reject(error)
      } else {
        resolve()
      }
    })
  })

// Every wait rejects after a deadline so a regression fails fast with a
// descriptive error instead of idling until the runner timeout — which would
// also skip the finally-based server cleanup and leak the listening handle.
const withTimeout = <T>(promise: Promise<T>, ms: number, label: string): Promise<T> => {
  let timer!: NodeJS.Timeout
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`Timed out waiting for ${label}`)), ms)
  })
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

const readBodyAfterDisconnect = async (
  body: string,
  headers: OutgoingHttpHeaders,
  send: (request: ClientRequest, body: string) => void,
  read: (c: BindingsContext) => Promise<unknown> = (c) => c.req.text()
): Promise<BodyReadResult> => {
  let notifyBodyComplete!: () => void
  const bodyComplete = new Promise<void>((resolve) => {
    notifyBodyComplete = resolve
  })

  let reportResult!: (result: BodyReadResult) => void
  const result = new Promise<BodyReadResult>((resolve) => {
    reportResult = resolve
  })

  const app = new Hono<{ Bindings: HttpBindings }>()
  app.post('/', async (c) => {
    try {
      const incoming = c.env.incoming
      const deadline = Date.now() + 1000
      while (!incoming.complete) {
        if (Date.now() > deadline) {
          throw new Error('Timed out waiting for the request body to complete')
        }
        await new Promise<void>((resolve) => setImmediate(resolve))
      }

      const aborted = new Promise<void>((resolve) => {
        incoming.once('aborted', resolve)
      })
      notifyBodyComplete()
      await withTimeout(aborted, 1000, 'the client disconnect')

      reportResult({ body: await read(c) })
    } catch (error) {
      reportResult({ error })
    }
    return c.text('done')
  })

  let server!: ServerType
  const address = await new Promise<AddressInfo>((resolve) => {
    server = serve(
      {
        fetch: app.fetch,
        hostname: '127.0.0.1',
        port: 0,
      },
      resolve
    )
  })

  const request = requestHTTP({
    headers,
    host: address.address,
    method: 'POST',
    path: '/',
    port: address.port,
  })
  request.on('error', () => {})
  send(request, body)

  try {
    await withTimeout(bodyComplete, 2000, 'the server to receive the request body')
    request.destroy()
    return await withTimeout(result, 4000, 'the body read result')
  } finally {
    request.destroy()
    await closeServer(server)
  }
}

describe('body reads after client disconnect', () => {
  const body = JSON.stringify({ hello: 'world' })

  it('reads a complete content-length body', async () => {
    const result = await readBodyAfterDisconnect(
      body,
      { 'content-length': Buffer.byteLength(body) },
      (request, value) => request.end(value)
    )

    expect(result).toEqual({ body })
  })

  it('reads a complete chunked body', async () => {
    const result = await readBodyAfterDisconnect(body, {}, (request, value) => {
      request.write(value)
      request.end()
    })

    expect(result).toEqual({ body })
  })

  it('reads a complete body via formData()', async () => {
    const form = 'hello=world&foo=bar'
    const result = await readBodyAfterDisconnect(
      form,
      {
        'content-length': Buffer.byteLength(form),
        'content-type': 'application/x-www-form-urlencoded',
      },
      (request, value) => request.end(value),
      async (c) => Object.fromEntries((await c.req.formData()).entries())
    )

    expect(result).toEqual({ body: { hello: 'world', foo: 'bar' } })
  })

  it('reads a complete body through the raw body stream', async () => {
    const result = await readBodyAfterDisconnect(
      body,
      { 'content-length': Buffer.byteLength(body) },
      (request, value) => request.end(value),
      (c) => new Response(c.req.raw.body).text()
    )

    expect(result).toEqual({ body })
  })

  it('reads a complete body even when request properties were accessed after disconnect', async () => {
    const result = await readBodyAfterDisconnect(
      body,
      { 'content-length': Buffer.byteLength(body) },
      (request, value) => request.end(value),
      (c) => {
        // creates the internal native Request cache before the body is read
        void c.req.raw.cache
        return c.req.text()
      }
    )

    expect(result).toEqual({ body })
  })
})
