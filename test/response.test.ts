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

  describe('Response.json', () => {
    it('should return 200 with application/json content-type by default', () => {
      const res = Response.json({ hello: 'world' })
      expect(res.status).toBe(200)
      expect(res.headers.get('content-type')).toBe('application/json')
    })

    it('should serialize data correctly', async () => {
      const data = { hello: 'world', num: 42, arr: [1, 2, 3] }
      const res = Response.json(data)
      expect(await res.json()).toEqual(data)
    })

    it('should use custom status from init', () => {
      const res = Response.json({ error: 'not found' }, { status: 404 })
      expect(res.status).toBe(404)
    })

    it('should preserve statusText from init', () => {
      const res = Response.json({ error: 'not found' }, { status: 404, statusText: 'Not Found' })
      expect(res.statusText).toBe('Not Found')
    })

    it('should preserve custom content-type from init headers', () => {
      const res = Response.json(
        { data: 'test' },
        { headers: { 'content-type': 'application/vnd.api+json' } }
      )
      expect(res.headers.get('content-type')).toBe('application/vnd.api+json')
    })

    it('should set application/json when init headers do not include content-type', () => {
      const res = Response.json({ data: 'test' }, { headers: { 'x-custom': 'value' } })
      expect(res.headers.get('content-type')).toBe('application/json')
      expect(res.headers.get('x-custom')).toBe('value')
    })

    it('should return a LightweightResponse with cacheKey set for the fast path', () => {
      const res = Response.json({ ok: true })
      expect(res).toBeInstanceOf(LightweightResponse)
      expect(cacheKey in res).toBe(true)
    })

    it('should throw for non-serializable data', () => {
      const circ: Record<string, unknown> = {}
      circ.self = circ
      expect(() => Response.json(circ)).toThrow(TypeError)
    })
  })

  describe('Response.redirect', () => {
    it('should return a 302 redirect by default', () => {
      const res = Response.redirect('https://example.com')
      expect(res.status).toBe(302)
      expect(res.headers.get('location')).toBe('https://example.com')
    })

    it('should use a custom redirect status', () => {
      const res = Response.redirect('https://example.com/new', 301)
      expect(res.status).toBe(301)
    })

    it('should accept a URL object', () => {
      const res = Response.redirect(new URL('https://example.com/path'))
      expect(res.headers.get('location')).toBe('https://example.com/path')
    })

    it('should throw for invalid status codes', () => {
      expect(() => Response.redirect('https://example.com', 200)).toThrow(RangeError)
    })

    it('should return a LightweightResponse with cacheKey set for the fast path', () => {
      const res = Response.redirect('https://example.com')
      expect(res).toBeInstanceOf(LightweightResponse)
      expect(cacheKey in res).toBe(true)
    })
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
