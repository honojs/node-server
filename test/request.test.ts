import { IncomingMessage } from 'node:http'
import type { ServerHttp2Stream } from 'node:http2'
import { Http2ServerRequest } from 'node:http2'
import { Socket } from 'node:net'
import { Duplex } from 'node:stream'
import {
  abortRequest,
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

    it('Should not generate GlobalRequest when accessing method, url or headers', async () => {
      const req = newRequest({
        method: 'GET',
        url: '/',
        headers: {
          host: 'localhost',
        },
        rawHeaders: ['host', 'localhost'],
      } as IncomingMessage)

      // keep lightweight request even if accessing method, url or headers
      expect(req.method).toBe('GET')
      expect(req.url).toBe('http://localhost/')
      expect(req.headers.get('host')).toBe('localhost')
      expect(req[abortControllerKey]).toBeUndefined()

      // generate GlobalRequest
      expect(req.keepalive).toBe(false)
      expect(req[abortControllerKey]).toBeDefined()
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

    it('should apply abort state lazily when signal is accessed after json() body read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      expect(await req.json()).toEqual({ foo: 'bar' })
      expect(req[abortControllerKey]).toBeUndefined()

      req[abortRequest]('Client connection prematurely closed.')
      expect(req[abortControllerKey]).toBeUndefined()

      expect(req.signal.aborted).toBe(true)
    })

    it('should reject direct body read when incoming stream is destroyed mid-read', async () => {
      const socket = new Socket()
      const incomingMessage = new IncomingMessage(socket)
      incomingMessage.method = 'POST'
      incomingMessage.headers = {
        host: 'localhost',
      }
      incomingMessage.rawHeaders = ['host', 'localhost']
      incomingMessage.url = '/foo.txt'
      const req = newRequest(incomingMessage)

      const textPromise = req.json()
      incomingMessage.destroy(new Error('Client connection prematurely closed.'))

      await expect(textPromise).rejects.toBeInstanceOf(Error)
    })

    it('should reject direct body read when incoming stream is destroyed without error', async () => {
      const socket = new Socket()
      const incomingMessage = new IncomingMessage(socket)
      incomingMessage.method = 'POST'
      incomingMessage.headers = {
        host: 'localhost',
      }
      incomingMessage.rawHeaders = ['host', 'localhost']
      incomingMessage.url = '/foo.txt'
      const req = newRequest(incomingMessage)

      const textPromise = req.text()
      incomingMessage.destroy()

      await expect(textPromise).rejects.toBeInstanceOf(Error)
    })

    it('should reject direct body read for unsupported methods like native Request', async () => {
      for (const method of ['CONNECT', 'TRACK']) {
        const req = newRequest({
          method,
          headers: {
            host: 'localhost',
            'content-type': 'text/plain',
          },
          rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
          rawBody: Buffer.from('foo'),
          url: '/foo.txt',
        } as IncomingMessage & { rawBody: Buffer })

        await expect(req.text()).rejects.toBeInstanceOf(TypeError)
      }
    })

    it('should allow direct body read even when aborted before rawBody read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      req[abortRequest]('Client connection prematurely closed.')

      await expect(req.json()).resolves.toEqual({ foo: 'bar' })
    })

    it('should allow json() read even after signal is accessed first and then aborted', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      req[abortRequest]('Client connection prematurely closed.')
      expect(req.signal.aborted).toBe(true)

      await expect(req.json()).resolves.toEqual({ foo: 'bar' })
    })

    it('should keep bodyUsed consistent after aborted read regardless of signal access order', async () => {
      const reqWithoutSignal = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      reqWithoutSignal[abortRequest]('Client connection prematurely closed.')
      await expect(reqWithoutSignal.json()).resolves.toEqual({ foo: 'bar' })
      expect(reqWithoutSignal.bodyUsed).toBe(true)

      const reqWithSignal = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      expect(reqWithSignal.signal.aborted).toBe(false)
      reqWithSignal[abortRequest]('Client connection prematurely closed.')
      expect(reqWithSignal.signal.aborted).toBe(true)
      await expect(reqWithSignal.json()).resolves.toEqual({ foo: 'bar' })
      expect(reqWithSignal.bodyUsed).toBe(true)
    })

    it('should allow clone() and formData() after abort like native Request', async () => {
      const reqForClone = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      reqForClone[abortRequest]('Client connection prematurely closed.')
      const cloned = reqForClone.clone()
      await expect(cloned.text()).resolves.toBe('foo')

      const reqForFormData = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/x-www-form-urlencoded',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/x-www-form-urlencoded'],
        rawBody: Buffer.from('a=1&b=2'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      reqForFormData[abortRequest]('Client connection prematurely closed.')
      const formData = await reqForFormData.formData()
      expect(formData.get('a')).toBe('1')
      expect(formData.get('b')).toBe('2')
    })

    it('should reject direct body read when incoming stream has already been consumed', async () => {
      const socket = new Socket()
      const incomingMessage = new IncomingMessage(socket)
      incomingMessage.method = 'POST'
      incomingMessage.headers = {
        host: 'localhost',
      }
      incomingMessage.rawHeaders = ['host', 'localhost']
      incomingMessage.url = '/foo.txt'
      incomingMessage.push('foo')
      incomingMessage.push(null)

      for await (const chunk of incomingMessage) {
        // consume body before lightweight request reads it
        expect(chunk).toBeDefined()
      }

      const req = newRequest(incomingMessage)
      await expect(req.text()).rejects.toBeInstanceOf(TypeError)
    })

    it('should resolve direct body read when stream already ended before first read', async () => {
      const socket = new Socket()
      const incomingMessage = new IncomingMessage(socket)
      incomingMessage.method = 'POST'
      incomingMessage.headers = {
        host: 'localhost',
      }
      incomingMessage.rawHeaders = ['host', 'localhost']
      incomingMessage.url = '/foo.txt'

      const req = newRequest(incomingMessage)
      const ended = new Promise<void>((resolve) => {
        incomingMessage.once('end', () => {
          resolve()
        })
      })
      incomingMessage.push(null)
      incomingMessage.resume()
      await ended

      await expect(req.text()).resolves.toBe('')
      expect(req.bodyUsed).toBe(true)
    })

    it('should reject on second direct json() read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await expect(req.json()).resolves.toEqual({ foo: 'bar' })
      await expect(req.json()).rejects.toBeInstanceOf(TypeError)
    })

    it('should set bodyUsed and reject clone() after direct json() read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await expect(req.json()).resolves.toEqual({ foo: 'bar' })
      expect(req.bodyUsed).toBe(true)
      expect(() => req.clone()).toThrow(TypeError)
      await expect(req.text()).rejects.toBeInstanceOf(TypeError)
    })

    it('should support UTF-8 BOM in direct json() read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), Buffer.from('{"foo":"bar"}')]),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await expect(req.json()).resolves.toEqual({ foo: 'bar' })
    })

    it('should set bodyUsed and reject clone() after direct text() read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await expect(req.text()).resolves.toBe('foo')
      expect(req.bodyUsed).toBe(true)
      expect(() => req.clone()).toThrow(TypeError)
      await expect(req.arrayBuffer()).rejects.toBeInstanceOf(TypeError)
    })

    it('should reject second direct text() read even after accessing signal', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await expect(req.text()).resolves.toBe('foo')
      expect(req.signal.aborted).toBe(false)
      await expect(req.text()).rejects.toBeInstanceOf(TypeError)
    })

    it('should reject second direct json() read even after accessing signal', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/json',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/json'],
        rawBody: Buffer.from('{"foo":"bar"}'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await expect(req.json()).resolves.toEqual({ foo: 'bar' })
      expect(req.signal.aborted).toBe(false)
      await expect(req.json()).rejects.toBeInstanceOf(TypeError)
    })

    it('should set bodyUsed and reject clone() after direct arrayBuffer() read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'application/octet-stream',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'application/octet-stream'],
        rawBody: Buffer.from([1, 2, 3]),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      const ab = await req.arrayBuffer()
      expect(new Uint8Array(ab)).toEqual(new Uint8Array([1, 2, 3]))
      expect(req.bodyUsed).toBe(true)
      expect(() => req.clone()).toThrow(TypeError)
      await expect(req.text()).rejects.toBeInstanceOf(TypeError)
    })

    it('should preserve content type in blob() result', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await expect(req.blob().then((blob: Blob) => blob.type)).resolves.toBe('text/plain')
    })

    it('should normalize content type in blob() result like native Request', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain; charset=UTF-8',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain; charset=UTF-8'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      const expectedType = await new GlobalRequest('http://localhost/foo.txt', {
        method: 'POST',
        headers: {
          'content-type': 'text/plain; charset=UTF-8',
        },
        body: 'foo',
      })
        .blob()
        .then((blob: Blob) => blob.type)

      await expect(req.blob().then((blob: Blob) => blob.type)).resolves.toBe(expectedType)
    })

    it('should set bodyUsed and reject clone() after direct blob() read', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      const blob = await req.blob()
      expect(blob.type).toBe('text/plain')
      expect(await blob.text()).toBe('foo')
      expect(req.bodyUsed).toBe(true)
      expect(() => req.clone()).toThrow(TypeError)
      await expect(req.json()).rejects.toBeInstanceOf(TypeError)
    })

    it('should allow constructing Request from consumed lightweight request when body is replaced', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await req.text()

      const req2 = new LightweightRequest(req, {
        method: 'POST',
        body: 'bar',
      })
      await expect(req2.text()).resolves.toBe('bar')
    })

    it('should throw when constructing Request from consumed lightweight request without body replacement', async () => {
      const req = newRequest({
        method: 'POST',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      await req.text()

      expect(() => {
        new LightweightRequest(req)
      }).toThrow(TypeError)
    })

    it('should preserve TRACE workaround after direct read when accessing signal', async () => {
      const socket = new Socket()
      const incomingMessage = new IncomingMessage(socket)
      incomingMessage.method = 'TRACE'
      incomingMessage.headers = {
        host: 'localhost',
        'content-type': 'text/plain',
      }
      incomingMessage.rawHeaders = ['host', 'localhost', 'content-type', 'text/plain']
      incomingMessage.url = '/foo.txt'
      ;(incomingMessage as IncomingMessage & { rawBody: Buffer }).rawBody = Buffer.from('foo')
      const req = newRequest(incomingMessage)

      await expect(req.text()).resolves.toBe('foo')
      expect(() => req.signal).not.toThrow()
    })

    it('should keep TRACE direct body read behavior regardless of signal access order', async () => {
      const createTraceRequest = () => {
        const socket = new Socket()
        const incomingMessage = new IncomingMessage(socket)
        incomingMessage.method = 'TRACE'
        incomingMessage.headers = {
          host: 'localhost',
          'content-type': 'text/plain',
        }
        incomingMessage.rawHeaders = ['host', 'localhost', 'content-type', 'text/plain']
        incomingMessage.url = '/foo.txt'
        ;(incomingMessage as IncomingMessage & { rawBody: Buffer }).rawBody = Buffer.from('foo')
        return newRequest(incomingMessage)
      }

      const reqBeforeSignal = createTraceRequest()
      await expect(reqBeforeSignal.text()).resolves.toBe('foo')

      const reqAfterSignal = createTraceRequest()
      expect(() => reqAfterSignal.signal).not.toThrow()
      await expect(reqAfterSignal.text()).resolves.toBe('foo')
    })

    it('should reject non-uppercase trace consistently regardless of access order', async () => {
      const createTraceLikeRequest = (method: string) => {
        const socket = new Socket()
        const incomingMessage = new IncomingMessage(socket)
        incomingMessage.method = method
        incomingMessage.headers = {
          host: 'localhost',
          'content-type': 'text/plain',
        }
        incomingMessage.rawHeaders = ['host', 'localhost', 'content-type', 'text/plain']
        incomingMessage.url = '/foo.txt'
        ;(incomingMessage as IncomingMessage & { rawBody: Buffer }).rawBody = Buffer.from('foo')
        return newRequest(incomingMessage)
      }

      for (const method of ['trace', 'TrAcE']) {
        const reqBeforeSignal = createTraceLikeRequest(method)
        await expect(reqBeforeSignal.text()).rejects.toBeInstanceOf(TypeError)

        const reqAfterSignal = createTraceLikeRequest(method)
        expect(() => reqAfterSignal.signal).toThrow(/HTTP method is unsupported/)
      }
    })

    it('should preserve non-standard method casing like native Request', async () => {
      for (const method of ['patch', 'CuStOm']) {
        const req = newRequest({
          method,
          headers: {
            host: 'localhost',
          },
          rawHeaders: ['host', 'localhost'],
          url: '/foo.txt',
        } as IncomingMessage)

        const expected = new GlobalRequest('http://localhost/foo.txt', { method }).method
        expect(req.method).toBe(expected)
      }
    })

    it('should normalize lowercase methods and keep GET behavior consistent', async () => {
      const req = newRequest({
        method: 'get',
        headers: {
          host: 'localhost',
          'content-type': 'text/plain',
        },
        rawHeaders: ['host', 'localhost', 'content-type', 'text/plain'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      expect(req.method).toBe('GET')
      expect(() => req.signal).not.toThrow()
      await expect(req.text()).resolves.toBe('')
      expect(req.bodyUsed).toBe(false)
    })

    it('should keep default GET behavior when incoming.method is missing', async () => {
      const req = newRequest({
        headers: {
          host: 'localhost',
        },
        rawHeaders: ['host', 'localhost'],
        rawBody: Buffer.from('foo'),
        url: '/foo.txt',
      } as IncomingMessage & { rawBody: Buffer })

      expect(req.method).toBe('GET')
      expect(await req.text()).toBe('')
      expect(req.bodyUsed).toBe(false)
      expect(() => req.signal).not.toThrow()
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

    it('Should throw error if host header port is invalid', async () => {
      expect(() => {
        newRequest({
          headers: {
            host: 'localhost:65536',
          },
          url: '/foo.txt',
        } as IncomingMessage)
      }).toThrow(RequestError)
    })

    it('Should be created request body from `req.rawBody` if it exists', async () => {
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

    describe('absolute-form for request-target', () => {
      it('should be created from valid absolute URL', async () => {
        const req = newRequest({
          url: 'http://localhost/path/to/file.html',
        } as IncomingMessage)
        expect(req).toBeInstanceOf(GlobalRequest)
        expect(req.url).toBe('http://localhost/path/to/file.html')
      })

      it('should throw error if host header is invalid', async () => {
        expect(() => {
          newRequest({
            url: 'http://',
          } as IncomingMessage)
        }).toThrow(RequestError)
      })

      it('should throw error if absolute-form is specified via HTTP/2', async () => {
        expect(() => {
          newRequest(
            new Http2ServerRequest(
              new Duplex() as ServerHttp2Stream,
              {
                ':scheme': 'http',
                ':authority': 'localhost',
                ':path': 'http://localhost/foo.txt',
              },
              {},
              []
            )
          )
        }).toThrow(RequestError)
      })
    })

    describe('HTTP/2', () => {
      it('should be created from "http" scheme', async () => {
        const req = newRequest(
          new Http2ServerRequest(
            new Duplex() as ServerHttp2Stream,
            {
              ':scheme': 'http',
              ':authority': 'localhost',
              ':path': '/foo.txt',
            },
            {},
            []
          )
        )
        expect(req).toBeInstanceOf(GlobalRequest)
        expect(req.url).toBe('http://localhost/foo.txt')
      })

      it('should be created from "https" scheme', async () => {
        const req = newRequest(
          new Http2ServerRequest(
            new Duplex() as ServerHttp2Stream,
            {
              ':scheme': 'https',
              ':authority': 'localhost',
              ':path': '/foo.txt',
            },
            {},
            []
          )
        )
        expect(req).toBeInstanceOf(GlobalRequest)
        expect(req.url).toBe('https://localhost/foo.txt')
      })

      it('should throw error if scheme is missing', async () => {
        expect(() => {
          newRequest(
            new Http2ServerRequest(
              new Duplex() as ServerHttp2Stream,
              {
                ':authority': 'localhost',
                ':path': '/foo.txt',
              },
              {},
              []
            )
          )
        }).toThrow(RequestError)
      })

      it('should throw error if unsupported scheme is specified', async () => {
        expect(() => {
          newRequest(
            new Http2ServerRequest(
              new Duplex() as ServerHttp2Stream,
              {
                ':scheme': 'ftp',
                ':authority': 'localhost',
                ':path': '/foo.txt',
              },
              {},
              []
            )
          )
        }).toThrow(RequestError)
      })
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
      await expect(req2.text()).resolves.toBe('bar')
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
      await expect(req2.text()).resolves.toBe('bar')
    })
  })
})

describe('RequestError', () => {
  it('should have a static name property (class name)', () => {
    expect(RequestError.name).toBe('RequestError')
    expect(Object.hasOwn(RequestError, 'name')).toBe(true)
  })

  it('should have an instance name property', () => {
    const error = new RequestError('message')
    expect(error.name).toBe('RequestError')
    expect(Object.hasOwn(error, 'name')).toBe(true)
  })
})
