import request from 'supertest'
import { createServer } from 'node:http'
import { getRequestListener } from '../src/listener'
import { GlobalRequest, Request as LightweightRequest, RequestError } from '../src/request'
import { GlobalResponse, Response as LightweightResponse } from '../src/response'

describe('Invalid request', () => {
  describe('default error handler', () => {
    const requestListener = getRequestListener(jest.fn())
    const server = createServer(requestListener)

    it('Should return server error for a request w/o host header', async () => {
      const res = await request(server).get('/').set('Host', '').send()
      expect(res.status).toBe(400)
    })

    it('Should return server error for a request invalid host header', async () => {
      const res = await request(server).get('/').set('Host', 'a b').send()
      expect(res.status).toBe(400)
    })
  })

  describe('custom error handler', () => {
    const requestListener = getRequestListener(jest.fn(), {
      errorHandler: (e) => {
        if (e instanceof RequestError) {
          return new Response(e.message, { status: 400 })
        } else {
          return new Response('unknown error', { status: 500 })
        }
      },
    })
    const server = createServer(requestListener)

    it('Should return server error for a request w/o host header', async () => {
      const res = await request(server).get('/').set('Host', '').send()
      expect(res.status).toBe(400)
    })

    it('Should return server error for a request invalid host header', async () => {
      const res = await request(server).get('/').set('Host', 'a b').send()
      expect(res.status).toBe(400)
    })

    it('Should return server error for host header with path', async () => {
      const res = await request(server).get('/').set('Host', 'a/b').send()
      expect(res.status).toBe(400)
    })
  })

  describe('default hostname', () => {
    const requestListener = getRequestListener(() => new Response('ok'), {
      hostname: 'example.com',
    })
    const server = createServer(requestListener)

    it('Should return 200 for a request w/o host header', async () => {
      const res = await request(server).get('/').set('Host', '').send()
      expect(res.status).toBe(200)
    })

    it('Should return server error for a request invalid host header', async () => {
      const res = await request(server).get('/').set('Host', 'a b').send()
      expect(res.status).toBe(400)
    })
  })

  describe('malformed body response', () => {
    const malformedResponse = {
      body: 'content',
    }
    const requestListener = getRequestListener(() => malformedResponse, {
      hostname: 'example.com',
    })
    const server = createServer(requestListener)

    it('Should return a 500 for a malformed response', async () => {
      const res = await request(server).get('/').send()
      expect(res.status).toBe(500)
    })
  })
})

describe('Error handling - sync fetchCallback', () => {
  const fetchCallback = jest.fn(() => {
    throw new Error('thrown error')
  })
  const errorHandler = jest.fn()

  const requestListener = getRequestListener(fetchCallback, { errorHandler })

  const server = createServer(async (req, res) => {
    await requestListener(req, res)

    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('error handler did not return a response')
    }
  })

  beforeEach(() => {
    errorHandler.mockReset()
  })

  it('Should set the response if error handler returns a response', async () => {
    errorHandler.mockImplementationOnce((err: Error) => {
      return new Response(`${err}`, { status: 500, headers: { 'my-custom-header': 'hi' } })
    })

    const res = await request(server).get('/throw-error')
    expect(res.status).toBe(500)
    expect(res.headers['my-custom-header']).toBe('hi')
    expect(res.text).toBe('Error: thrown error')
  })

  it('Should not set the response if the error handler does not return a response', async () => {
    errorHandler.mockImplementationOnce(() => {
      // do something else, such as passing error to vite next middleware, etc
    })

    const res = await request(server).get('/throw-error')
    expect(errorHandler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    expect(res.text).toBe('error handler did not return a response')
  })
})

describe('Error handling - async fetchCallback', () => {
  const fetchCallback = jest.fn(async () => {
    throw new Error('thrown error')
  })
  const errorHandler = jest.fn()

  const requestListener = getRequestListener(fetchCallback, { errorHandler })

  const server = createServer(async (req, res) => {
    await requestListener(req, res)

    if (!res.writableEnded) {
      res.writeHead(500, { 'Content-Type': 'text/plain' })
      res.end('error handler did not return a response')
    }
  })

  beforeEach(() => {
    errorHandler.mockReset()
  })

  it('Should set the response if error handler returns a response', async () => {
    errorHandler.mockImplementationOnce((err: Error) => {
      return new Response(`${err}`, { status: 500, headers: { 'my-custom-header': 'hi' } })
    })

    const res = await request(server).get('/throw-error')
    expect(res.status).toBe(500)
    expect(res.headers['my-custom-header']).toBe('hi')
    expect(res.text).toBe('Error: thrown error')
  })

  it('Should not set the response if the error handler does not return a response', async () => {
    errorHandler.mockImplementationOnce(() => {
      // do something else, such as passing error to vite next middleware, etc
    })

    const res = await request(server).get('/throw-error')
    expect(errorHandler).toHaveBeenCalledTimes(1)
    expect(res.status).toBe(500)
    expect(res.text).toBe('error handler did not return a response')
  })
})

describe('Abort request', () => {
  let onAbort: (req: Request) => void
  let reqReadyResolve: () => void
  let reqReadyPromise: Promise<void>
  const fetchCallback = async (req: Request) => {
    req.signal.addEventListener('abort', () => onAbort(req))
    reqReadyResolve?.()
    await new Promise(() => {}) // never resolve
  }

  const requestListener = getRequestListener(fetchCallback)

  const server = createServer(async (req, res) => {
    await requestListener(req, res)
  })

  beforeEach(() => {
    reqReadyPromise = new Promise<void>((r) => {
      reqReadyResolve = r
    })
  })

  afterAll(() => {
    server.close()
  })

  it.each(['get', 'put', 'patch', 'delete'] as const)(
    'should emit an abort event when the nodejs %s request is aborted',
    async (method) => {
      const requests: Request[] = []
      const abortedPromise = new Promise<void>((resolve) => {
        onAbort = (req) => {
          requests.push(req)
          resolve()
        }
      })

      const req = request(server)
        [method]('/abort')
        .end(() => {})

      await reqReadyPromise

      req.abort()

      await abortedPromise

      expect(requests).toHaveLength(1)
      const abortedReq = requests[0]
      expect(abortedReq).toBeInstanceOf(Request)
      expect(abortedReq.signal.aborted).toBe(true)
    }
  )

  it.each(['get', 'post', 'head', 'patch', 'delete', 'put'] as const)(
    'should emit an abort event when the nodejs request is aborted on multiple %s requests',
    async (method) => {
      const requests: Request[] = []

      {
        const abortedPromise = new Promise<void>((resolve) => {
          onAbort = (req) => {
            requests.push(req)
            resolve()
          }
        })

        reqReadyPromise = new Promise<void>((r) => {
          reqReadyResolve = r
        })

        const req = request(server)
          [method]('/abort')
          .end(() => {})

        await reqReadyPromise

        req.abort()

        await abortedPromise
      }

      expect(requests).toHaveLength(1)

      for (const abortedReq of requests) {
        expect(abortedReq).toBeInstanceOf(Request)
        expect(abortedReq.signal.aborted).toBe(true)
      }

      {
        const abortedPromise = new Promise<void>((resolve) => {
          onAbort = (req) => {
            requests.push(req)
            resolve()
          }
        })

        reqReadyPromise = new Promise<void>((r) => {
          reqReadyResolve = r
        })

        const req = request(server)
          [method]('/abort')
          .end(() => {})

        await reqReadyPromise

        req.abort()

        await abortedPromise
      }

      expect(requests).toHaveLength(2)

      for (const abortedReq of requests) {
        expect(abortedReq).toBeInstanceOf(Request)
        expect(abortedReq.signal.aborted).toBe(true)
      }
    }
  )

  it('should handle request abort without requestCache', async () => {
    const fetchCallback = async () => {
      // NOTE: we don't req.signal
      await new Promise(() => {}) // never resolve
    }
    const requestListener = getRequestListener(fetchCallback)
    const server = createServer(requestListener)
    const req = request(server).post('/abort').timeout({ deadline: 1 })
    await expect(req).rejects.toHaveProperty('timeout')
  })
})

describe('overrideGlobalObjects', () => {
  const fetchCallback = jest.fn()

  beforeEach(() => {
    Object.defineProperty(global, 'Request', {
      value: GlobalRequest,
      writable: true,
    })
    Object.defineProperty(global, 'Response', {
      value: GlobalResponse,
      writable: true,
    })
  })

  describe('default', () => {
    it('Should be overridden', () => {
      getRequestListener(fetchCallback)
      expect(global.Request).toBe(LightweightRequest)
      expect(global.Response).toBe(LightweightResponse)
    })
  })

  describe('overrideGlobalObjects: true', () => {
    it('Should be overridden', () => {
      getRequestListener(fetchCallback, {
        overrideGlobalObjects: true,
      })
      expect(global.Request).toBe(LightweightRequest)
      expect(global.Response).toBe(LightweightResponse)
    })
  })

  describe('overrideGlobalObjects: false', () => {
    it('Should not be overridden', () => {
      getRequestListener(fetchCallback, {
        overrideGlobalObjects: false,
      })
      expect(global.Request).toBe(GlobalRequest)
      expect(global.Response).toBe(GlobalResponse)
    })
  })
})
