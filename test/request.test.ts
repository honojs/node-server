import type { IncomingMessage } from 'node:http'
import { newRequest, Request, GlobalRequest, getAbortController } from '../src/request'

describe('Request', () => {
  describe('newRequest', () => {
    it('Compatibility with standard Request object', async () => {
      const req = newRequest({
        method: 'GET',
        url: '/',
        headers: {
          host: 'localhost',
        },
        rawHeaders: ['host', 'localhost'],
      } as IncomingMessage)

      expect(req).toBeInstanceOf(global.Request)
      expect(req.method).toBe('GET')
      expect(req.url).toBe('http://localhost/')
      expect(req.headers.get('host')).toBe('localhost')
      expect(req.keepalive).toBe(false)
    })

    it('Should resolve double dots in URL', async () => {
      const req = newRequest({
        headers: {
          host: 'localhost',
        },
        url: '/static/../foo.txt',
      } as IncomingMessage)
      expect(req).toBeInstanceOf(global.Request)
      expect(req.url).toBe('http://localhost/foo.txt')
    })

    it('Should resolve double dots in host header', async () => {
      const req = newRequest({
        headers: {
          host: 'localhost/..',
        },
        url: '/foo.txt',
      } as IncomingMessage)
      expect(req).toBeInstanceOf(global.Request)
      expect(req.url).toBe('http://localhost/foo.txt')
    })

    it('should generate only one `AbortController` per `Request` object created', async () => {
      const req = newRequest({
        headers: {
          host: 'localhost/..',
        },
        rawHeaders: ['host', 'localhost/..'],
        url: '/foo.txt',
      } as IncomingMessage)
      const req2 = newRequest({
        headers: {
          host: 'localhost/..',
        },
        rawHeaders: ['host', 'localhost/..'],
        url: '/foo.txt',
      } as IncomingMessage)

      const x = req[getAbortController]()
      const y = req[getAbortController]()
      const z = req2[getAbortController]()

      expect(x).toBeInstanceOf(AbortController)
      expect(y).toBeInstanceOf(AbortController)
      expect(z).toBeInstanceOf(AbortController)
      expect(x).toBe(y)
      expect(z).not.toBe(x)
      expect(z).not.toBe(y)
    })
  })

  describe('GlobalRequest', () => {
    it('should be overrode by Request', () => {
      expect(Request).not.toBe(GlobalRequest)
    })

    it('should be instance of GlobalRequest', () => {
      const req = new Request('http://localhost/')
      expect(req).toBeInstanceOf(GlobalRequest)
    })

    it('should be success to create instance from old light weight instance', async () => {
      const req = newRequest({
        method: 'GET',
        url: '/',
        headers: {
          host: 'localhost',
        },
        rawHeaders: ['host', 'localhost'],
      } as IncomingMessage)
      const req2 = new Request(req, {
        method: 'POST',
        body: 'foo',
      })
      expect(req2).toBeInstanceOf(GlobalRequest)
      expect(await req2.text()).toBe('foo')
    })

    it('should set `duplex: "half"` automatically if body is a ReadableStream', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('bar'))
          controller.close()
        },
      })
      const req2 = new Request('http://localhost', {
        method: 'POST',
        body: stream,
      })
      expect(req2).toBeInstanceOf(GlobalRequest)
      expect(req2.text()).resolves.toBe('bar')
    })
  })
})
