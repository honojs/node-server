import { IncomingMessage } from 'node:http'
import { Socket } from 'node:net'
import {
  newRequest,
  Request as LightweightRequest,
  GlobalRequest,
  getAbortController,
  abortControllerKey,
  RequestError,
} from '../src/request'

Object.defineProperty(global, 'Request', {
  value: LightweightRequest,
})

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

    it('Should accept hostname and port in host header', async () => {
      const req = newRequest({
        headers: {
          host: 'localhost:8080',
        },
        url: '/static/../foo.txt',
      } as IncomingMessage)
      expect(req).toBeInstanceOf(global.Request)
      expect(req.url).toBe('http://localhost:8080/foo.txt')
    })

    it('should generate only one `AbortController` per `Request` object created', async () => {
      const req = newRequest({
        headers: {
          host: 'localhost',
        },
        rawHeaders: ['host', 'localhost'],
        url: '/foo.txt',
      } as IncomingMessage)
      const req2 = newRequest({
        headers: {
          host: 'localhost',
        },
        rawHeaders: ['host', 'localhost'],
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

    it('should be able to safely check if an AbortController has been initialized by referencing the abortControllerKey', async () => {
      const req = newRequest({
        headers: {
          host: 'localhost',
        },
        rawHeaders: ['host', 'localhost'],
        url: '/foo.txt',
      } as IncomingMessage)

      expect(req[abortControllerKey]).toBeUndefined() // not initialized, do not initialize internal request object automatically

      expect(req[getAbortController]()).toBeDefined()
      expect(req[abortControllerKey]).toBeDefined() // initialized
    })

    it('Should throw error if host header contains path', async () => {
      expect(() => {
        newRequest({
          headers: {
            host: 'localhost/..',
          },
          url: '/foo.txt',
        } as IncomingMessage)
      }).toThrow(RequestError)
    })

    it('Should throw error if host header is empty', async () => {
      expect(() => {
        newRequest({
          headers: {
            host: '',
          },
          url: '/foo.txt',
        } as IncomingMessage)
      }).toThrow(RequestError)
    })

    it('Should throw error if host header contains query parameter', async () => {
      expect(() => {
        newRequest({
          headers: {
            host: 'localhost?foo=bar',
          },
          url: '/foo.txt',
        } as IncomingMessage)
      }).toThrow(RequestError)
    })

    it('Should be create request body from `req.rawBody` if it exists', async () => {
      const rawBody = Buffer.from('foo')
      const socket = new Socket()
      const incomingMessage = new IncomingMessage(socket)
      incomingMessage.method = 'POST'
      incomingMessage.headers = {
        host: 'localhost',
      }
      incomingMessage.url = '/foo.txt'
      ;(incomingMessage as IncomingMessage & { rawBody: Buffer }).rawBody = rawBody
      incomingMessage.push(rawBody)
      incomingMessage.push(null)

      for await (const chunk of incomingMessage) {
        // consume body
        expect(chunk).toBeDefined()
      }

      const req = newRequest(incomingMessage)
      const text = await req.text()
      expect(text).toBe('foo')
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

    it('should skip to set `duplex: "half"` if init option is a Request object', async () => {
      const stream = new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('bar'))
          controller.close()
        },
      })
      const req = new Request('http://localhost', {
        method: 'POST',
        body: stream,
      })
      const req2 = new Request('http://localhost/subapp', req)
      expect(req2).toBeInstanceOf(GlobalRequest)
      expect(req2.text()).resolves.toBe('bar')
    })
  })
})
