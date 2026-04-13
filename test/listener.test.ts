import request from 'supertest'
import { createServer } from 'node:http'
import { getRequestListener } from '../src/listener'
import { GlobalRequest, Request as LightweightRequest, RequestError } from '../src/request'
import { GlobalResponse, Response as LightweightResponse } from '../src/response'

const withTimeout = async <T>(promise: Promise<T>, message: string): Promise<T> => {
  let timeoutId: ReturnType<typeof setTimeout> | undefined

  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(new Error(message))
        }, 1_000)
      }),
    ])
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId)
    }
  }
}

const runRequestAndCollectOutgoingEvents = async (
  fetchCallback: Parameters<typeof getRequestListener>[0]
): Promise<{
  closeListenerCount: number
  response: request.Response
}> => {
  let closeListenerCount = 0
  const requestListener = getRequestListener(fetchCallback)
  const server = createServer(async (req, res) => {
    const originalOn = res.on.bind(res)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    ;(res as any).on = ((event: string, listener: (...args: any[]) => void) => {
      if (event === 'close') {
        closeListenerCount++
      }
      return originalOn(event, listener)
    }) as typeof res.on

    await requestListener(req, res)
  })

  try {
    const response = await request(server).get('/')
    return { closeListenerCount, response }
  } finally {
    server.close()
  }
}

describe('Invalid request', () => {
  describe('default error handler', () => {
    const requestListener = getRequestListener(vi.fn())
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
    const requestListener = getRequestListener(vi.fn(), {
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
  const fetchCallback = vi.fn(() => {
    throw new Error('thrown error')
  })
  const errorHandler = vi.fn()

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
  const fetchCallback = vi.fn(async () => {
    throw new Error('thrown error')
  })
  const errorHandler = vi.fn()

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

describe('Abort request - error path', () => {
  const runAbortDuringErrorHandlerCase = async (mode: 'sync' | 'async') => {
    let capturedReq: Request | undefined
    let resolveAborted!: () => void
    const abortedPromise = new Promise<void>((r) => {
      resolveAborted = r
    })

    let resolveErrorHandlerStarted!: () => void
    const errorHandlerStarted = new Promise<void>((r) => {
      resolveErrorHandlerStarted = r
    })

    const onRequest = (req: Request) => {
      capturedReq = req
      req.signal.addEventListener('abort', resolveAborted)
    }

    const fetchCallback =
      mode === 'sync'
        ? (req: Request) => {
            onRequest(req)
            throw new Error('sync error')
          }
        : async (req: Request) => {
            onRequest(req)
            throw new Error('async error')
          }

    const errorHandler = async () => {
      resolveErrorHandlerStarted()
      await new Promise<void>(() => {}) // never resolves — client will disconnect first
    }

    const requestListener = getRequestListener(fetchCallback, { errorHandler })
    const server = createServer(requestListener)

    try {
      const req = request(server)
        .get('/')
        .end(() => {})
      await withTimeout(errorHandlerStarted, 'error handler did not start')
      req.abort()
      await withTimeout(abortedPromise, 'request abort did not propagate')
      expect(capturedReq?.signal.aborted).toBe(true)
    } finally {
      server.close()
    }
  }

  it.each(['sync', 'async'] as const)(
    'should abort request signal when client disconnects while async error handler is running after %s',
    async (mode) => {
      await runAbortDuringErrorHandlerCase(mode)
    }
  )
})

describe('Abort request - cacheable response path', () => {
  it.each([
    ['string', () => new Response('fast path')],
    ['Uint8Array', () => new Response(new TextEncoder().encode('fast path'))],
    ['null', () => new Response(null, { status: 204 })],
  ] as const)(
    'should avoid attaching a close listener for sync immediate cacheable %s responses',
    async (_type, createResponse) => {
      const { closeListenerCount, response } = await runRequestAndCollectOutgoingEvents(() =>
        createResponse()
      )

      expect(closeListenerCount).toBe(0)

      if (response.status === 204) {
        expect(response.text).toBe('')
      } else {
        expect(response.text).toBe('fast path')
      }
    }
  )

  it('should attach a close listener and send the body for sync Blob responses', async () => {
    const { closeListenerCount, response } = await runRequestAndCollectOutgoingEvents(
      () =>
        new Response(new Blob(['blob-body']), {
          headers: {
            'content-type': 'text/plain; charset=UTF-8',
          },
        })
    )

    expect(closeListenerCount).toBe(1)
    expect(response.text).toBe('blob-body')
  })

  it('should abort request signal when client disconnects during sync cacheable ReadableStream response', async () => {
    let resolveAborted!: () => void
    const abortedPromise = new Promise<void>((r) => {
      resolveAborted = r
    })

    let capturedReq: Request | undefined
    let resolveStreamConstructed!: () => void
    const streamConstructed = new Promise<void>((r) => {
      resolveStreamConstructed = r
    })

    const fetchCallback = (req: Request) => {
      capturedReq = req
      req.signal.addEventListener('abort', resolveAborted)

      const body = new ReadableStream({
        start() {
          resolveStreamConstructed()
        },
        async pull() {
          await new Promise<void>(() => {}) // never resolves — client will disconnect first
        },
      })

      return new Response(body)
    }

    const requestListener = getRequestListener(fetchCallback)
    const server = createServer(requestListener)

    try {
      const req = request(server)
        .get('/')
        .end(() => {})
      await withTimeout(streamConstructed, 'stream body was not constructed')
      req.abort()
      await withTimeout(abortedPromise, 'request abort did not propagate for cacheable stream')
      expect(capturedReq?.signal.aborted).toBe(true)
    } finally {
      server.close()
    }
  })
})

describe('overrideGlobalObjects', () => {
  const fetchCallback = vi.fn()

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
