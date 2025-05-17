import { createServer } from 'node:http'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { GlobalResponse, Response as LightweightResponse, cacheKey } from '../src/response'

Object.defineProperty(global, 'Response', {
  value: LightweightResponse,
})

class NextResponse extends LightweightResponse {}

class UpperCaseStream extends TransformStream {
  constructor() {
    super({
      transform(chunk, controller) {
        controller.enqueue(
          new TextEncoder().encode(new TextDecoder().decode(chunk).toString().toUpperCase())
        )
      },
    })
  }
}

describe('Response', () => {
  let server: Server
  let port: number
  beforeAll(
    async () =>
      new Promise<void>((resolve) => {
        server = createServer((_, res) => {
          res.writeHead(200, {
            'Content-Type': 'application/json charset=UTF-8',
          })
          res.end(JSON.stringify({ status: 'ok' }))
        })
          .listen(0)
          .on('listening', () => {
            port = (server.address() as AddressInfo).port
            resolve()
          })
      })
  )

  afterAll(() => {
    server.close()
  })

  it('Should be overrode by Response', () => {
    expect(Response).not.toBe(GlobalResponse)
  })

  it('Compatibility with standard Response object', async () => {
    // response name not changed
    expect(Response.name).toEqual('Response')

    // response prototype chain not changed
    expect(new Response()).toBeInstanceOf(GlobalResponse)

    // `fetch()` and `Response` are not changed
    const fetchRes = await fetch(`http://localhost:${port}`)
    expect(new Response()).toBeInstanceOf(fetchRes.constructor)
    const resJson = await fetchRes.json()
    expect(fetchRes.headers.get('content-type')).toEqual('application/json charset=UTF-8')
    expect(resJson).toEqual({ status: 'ok' })

    // can only use new operator
    expect(() => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(Response as any)()
    }).toThrow()

    // support Response static method
    expect(Response.error).toEqual(expect.any(Function))
    expect(Response.json).toEqual(expect.any(Function))
    expect(Response.redirect).toEqual(expect.any(Function))

    // support other class to extends from Response
    expect(new NextResponse()).toBeInstanceOf(Response)
  })

  it('Should not lose header data', async () => {
    const parentResponse = new Response('OK', {
      headers: {
        'content-type': 'application/json',
      },
    })
    const childResponse = new Response('OK', parentResponse)
    parentResponse.headers.delete('content-type')
    expect(childResponse.headers.get('content-type')).toEqual('application/json')
  })

  it('Nested constructors should not cause an error even if ReadableStream is specified', async () => {
    const stream = new Response('hono').body
    const parentResponse = new Response(stream)
    const upperCaseStream = new UpperCaseStream()
    const childResponse = new Response(
      parentResponse.body!.pipeThrough(upperCaseStream),
      parentResponse
    )
    expect(await childResponse.text()).toEqual('HONO')
  })

  describe('Fallback to GlobalResponse object', () => {
    it('Should return value from internal cache', () => {
      const res = new Response('Hello! Node!')
      res.headers.set('x-test', 'test')
      expect(res.headers.get('x-test')).toEqual('test')
      expect(res.status).toEqual(200)
      expect(res.ok).toEqual(true)
      expect(cacheKey in res).toBe(true)
    })

    it('Should return value from generated GlobalResponse object', () => {
      const res = new Response('Hello! Node!', {
        statusText: 'OK',
      })
      expect(res.statusText).toEqual('OK')
      expect(cacheKey in res).toBe(false)
    })
  })
})
