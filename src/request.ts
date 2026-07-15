/* eslint-disable @typescript-eslint/no-explicit-any */
// Define prototype for lightweight pseudo Request object

import type { IncomingMessage } from 'node:http'
import { Http2ServerRequest } from 'node:http2'
import { Readable } from 'node:stream'
import type { ReadableStreamDefaultReader } from 'node:stream/web'
import type { TLSSocket } from 'node:tls'
import { RequestError } from './error'
import { buildUrl } from './url'

export { RequestError }

export const toRequestError = (e: unknown): RequestError => {
  if (e instanceof RequestError) {
    return e
  }
  return new RequestError((e as Error).message, { cause: e })
}

export const GlobalRequest = global.Request
export class Request extends GlobalRequest {
  constructor(input: string | Request, options?: RequestInit) {
    if (typeof input === 'object' && getRequestCache in input) {
      // Match native Request behavior:
      // constructing from a consumed Request is allowed only when init.body is non-null.
      const hasReplacementBody =
        options !== undefined && 'body' in options && (options as RequestInit).body != null
      if ((input as any)[bodyConsumedDirectlyKey] && !hasReplacementBody) {
        throw new TypeError(
          'Cannot construct a Request with a Request object that has already been used.'
        )
      }
      input = (input as any)[getRequestCache]()
    }
    // Check if body is ReadableStream like. This makes it compatbile with ReadableStream polyfills.
    if (typeof (options?.body as ReadableStream)?.getReader !== 'undefined') {
      // Half duplex mode is required when request body is a stream.
      // If already set, do nothing since a Request object was passed to the options or explicitly set by the user.
      ;(options as any).duplex ??= 'half'
    }
    super(input, options)
  }
}

const newHeadersFromIncoming = (incoming: IncomingMessage | Http2ServerRequest) => {
  const headerRecord: [string, string][] = []
  const rawHeaders = incoming.rawHeaders
  for (let i = 0, len = rawHeaders.length; i < len; i += 2) {
    const key = rawHeaders[i]
    if (key.charCodeAt(0) !== /*:*/ 0x3a) {
      headerRecord.push([key, rawHeaders[i + 1]])
    }
  }
  return new Headers(headerRecord)
}

export type IncomingMessageWithWrapBodyStream = IncomingMessage & { [wrapBodyStream]: boolean }
export const wrapBodyStream = Symbol('wrapBodyStream')

// Encodings whose decode → re-encode round-trip is byte-exact for any input.
// utf8/utf16le replace invalid sequences with U+FFFD and ascii masks the high
// bit of every byte, so a body decoded through them cannot be reconstructed
// reliably — recovery is refused for those instead of returning corrupt bytes.
const byteExactEncodings = new Set(['latin1', 'binary', 'hex', 'base64', 'base64url'])

const isByteExactEncoding = (encoding: BufferEncoding | null): boolean =>
  encoding === null || byteExactEncodings.has(encoding)

const bodyBufferedBeforeDisconnectKey = Symbol('bodyBufferedBeforeDisconnect')
const bodyBufferedLengthBeforeDisconnectKey = Symbol('bodyBufferedLengthBeforeDisconnect')

type IncomingWithBodyRecovery = IncomingMessage & {
  [bodyBufferedBeforeDisconnectKey]?: Buffer | Error
  [bodyBufferedLengthBeforeDisconnectKey]?: number
}

// When setEncoding() was called on the stream, chunks arrive as strings in
// that encoding — decode with it so the original bytes are reconstructed.
const toBufferChunk = (chunk: Buffer | string, encoding: BufferEncoding | null): Buffer =>
  Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding ?? 'utf8')

const isRecoverableDisconnectedIncoming = (
  incoming: IncomingMessage | Http2ServerRequest
): incoming is IncomingMessage =>
  !(incoming instanceof Http2ServerRequest) &&
  !!incoming.complete &&
  !!incoming.readableAborted &&
  typeof incoming.read === 'function' &&
  isByteExactEncoding(incoming.readableEncoding)

// Remember how much complete HTTP/1 body data remained buffered when the
// disconnect was observed. A later raw read can drain a destroyed stream
// without updating readableDidRead, so the length snapshot is needed to keep
// the Fetch-style body from silently resolving with only the remainder.
export const recordBodyBufferedBeforeDisconnect = (
  incoming: IncomingMessage | Http2ServerRequest
): void => {
  if (incoming.readableDidRead || !isRecoverableDisconnectedIncoming(incoming)) {
    return
  }

  const incomingWithRecovery = incoming as IncomingWithBodyRecovery
  incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey] ??= incoming.readableLength
}

// A client may close the connection after Node has parsed the complete HTTP/1
// request but before the application starts reading it. In that state the
// IncomingMessage is disturbed/aborted, while the untouched body is still in
// its internal readable buffer — recover it instead of failing the read.
//
// HTTP/2 is excluded deliberately: an RST_STREAM discards the buffered request
// data at the protocol layer, and Http2ServerRequest#complete is also true for
// aborted/destroyed streams, so it cannot be trusted as a "fully received"
// signal.
//
// Returns the buffered body, an Error the read must fail with, or undefined
// when the stream is not in the recoverable state. The result is cached on the
// incoming object so every read path observes the same outcome.
const readBodyBufferedBeforeDisconnect = (
  incoming: IncomingMessage | Http2ServerRequest,
  chunks?: Buffer[]
): Buffer | Error | undefined => {
  if ((incoming.readableDidRead && !chunks) || !isRecoverableDisconnectedIncoming(incoming)) {
    return undefined
  }

  const incomingWithRecovery = incoming as IncomingWithBodyRecovery
  if (incomingWithRecovery[bodyBufferedBeforeDisconnectKey] !== undefined) {
    return incomingWithRecovery[bodyBufferedBeforeDisconnectKey]
  }

  let result: Buffer | Error
  const errored = incoming.errored
  if (errored && (errored as NodeJS.ErrnoException).code !== 'ECONNRESET') {
    // The stream was destroyed with an application-provided error (e.g. a
    // body-size guard calling incoming.destroy(err)). Node's own teardown of a
    // disconnected client uses ECONNRESET errors, which must still recover the
    // body — anything else is surfaced to the reader instead of swallowed.
    result = errored
  } else if (
    incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey] !== undefined &&
    incoming.readableLength !== incomingWithRecovery[bodyBufferedLengthBeforeDisconnectKey]
  ) {
    result = newBodyUnusableError()
  } else {
    const bodyChunks = chunks ?? []
    const chunk = incoming.read() as Buffer | string | null
    if (chunk !== null) {
      bodyChunks.push(toBufferChunk(chunk, incoming.readableEncoding))
    }
    const buffer = bodyChunks.length === 1 ? bodyChunks[0] : Buffer.concat(bodyChunks)
    result = buffer
    // Validate only canonical digit values: the HTTP parser guarantees this
    // form on real connections, and lenient coercion of synthetic inputs
    // (e.g. '0x10') would validate against a length the header never meant.
    const contentLength = incoming.headers['content-length']
    if (typeof contentLength === 'string' && /^\d+$/.test(contentLength)) {
      const expectedLength = Number(contentLength)
      if (Number.isSafeInteger(expectedLength) && buffer.length !== expectedLength) {
        result = newBodyUnusableError()
      }
    }
  }
  incomingWithRecovery[bodyBufferedBeforeDisconnectKey] = result
  return result
}

const enqueueBufferedBody = (
  controller: ReadableStreamDefaultController,
  buffered: Buffer | Error
): void => {
  if (buffered instanceof Error) {
    controller.error(buffered)
    return
  }
  if (buffered.length > 0) {
    controller.enqueue(buffered)
  }
  controller.close()
}
const newRequestFromIncoming = (
  method: string,
  url: string,
  headers: Headers,
  incoming: IncomingMessage | Http2ServerRequest,
  abortController: AbortController
): Request => {
  const init = {
    method: method,
    headers,
    signal: abortController.signal,
  } as RequestInit

  if (method === 'TRACE') {
    init.method = 'GET'
    const req = new Request(url, init)
    Object.defineProperty(req, 'method', {
      get() {
        return 'TRACE'
      },
    })
    return req
  }

  if (!(method === 'GET' || method === 'HEAD')) {
    if ('rawBody' in incoming && incoming.rawBody instanceof Buffer) {
      // In some environments (e.g. firebase functions), the body is already consumed.
      // So we need to re-read the request body from `incoming.rawBody` if available.
      init.body = new ReadableStream({
        start(controller) {
          controller.enqueue(incoming.rawBody)
          controller.close()
        },
      })
    } else if ((incoming as IncomingMessageWithWrapBodyStream)[wrapBodyStream]) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined
      init.body = new ReadableStream({
        async pull(controller) {
          try {
            if (!reader) {
              const buffered = readBodyBufferedBeforeDisconnect(incoming)
              if (buffered !== undefined) {
                enqueueBufferedBody(controller, buffered)
                return
              }
            }
            reader ||= Readable.toWeb(incoming).getReader()
            const { done, value } = await reader.read()
            if (done) {
              controller.close()
            } else {
              controller.enqueue(value)
            }
          } catch (error) {
            controller.error(error)
          }
        },
      })
    } else {
      const buffered = readBodyBufferedBeforeDisconnect(incoming)
      if (buffered !== undefined) {
        init.body = new ReadableStream({
          start(controller) {
            enqueueBufferedBody(controller, buffered)
          },
        })
      } else {
        // lazy-consume request body
        init.body = Readable.toWeb(incoming) as ReadableStream<Uint8Array>
      }
    }
  }

  return new Request(url, init)
}

const getRequestCache = Symbol('getRequestCache')
const requestCache = Symbol('requestCache')
const incomingKey = Symbol('incomingKey')
const urlKey = Symbol('urlKey')
const methodKey = Symbol('methodKey')
const headersKey = Symbol('headersKey')
export const abortControllerKey = Symbol('abortControllerKey')
export const getAbortController = Symbol('getAbortController')
export const abortRequest = Symbol('abortRequest')
const bodyBufferKey = Symbol('bodyBuffer')
const bodyReadPromiseKey = Symbol('bodyReadPromise')
const bodyConsumedDirectlyKey = Symbol('bodyConsumedDirectly')
const bodyLockReaderKey = Symbol('bodyLockReader')
const abortReasonKey = Symbol('abortReason')

const newBodyUnusableError = (): TypeError => {
  return new TypeError('Body is unusable')
}

const rejectBodyUnusable = (): Promise<never> => {
  return Promise.reject(newBodyUnusableError())
}

const textDecoder = new TextDecoder()

const consumeBodyDirectOnce = (
  request: Record<string | symbol, any>
): Promise<never> | undefined => {
  if (request[bodyConsumedDirectlyKey]) {
    return rejectBodyUnusable()
  }
  request[bodyConsumedDirectlyKey] = true
  return undefined
}

const toArrayBuffer = (buf: Buffer): ArrayBuffer => {
  return buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) as ArrayBuffer
}

const contentType = (request: Record<string | symbol, any>): string => {
  return (
    (request[headersKey] ||= newHeadersFromIncoming(request[incomingKey])).get('content-type') || ''
  )
}

type DirectBodyReadMethod = 'text' | 'arrayBuffer' | 'blob'

const methodTokenRegExp = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

const normalizeIncomingMethod = (method: unknown): string => {
  if (typeof method !== 'string' || method.length === 0) {
    return 'GET'
  }

  // fast path for already-uppercase common methods from Node.js.
  switch (method) {
    case 'DELETE':
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
    case 'POST':
    case 'PUT':
    case 'QUERY':
      return method
  }

  const upper = method.toUpperCase()
  // Fetch only normalizes these methods for backwards compatibility.
  // HTTP methods are otherwise case-sensitive, so methods not in this list
  // (including `query`) must retain their original casing.
  switch (upper) {
    case 'DELETE':
    case 'GET':
    case 'HEAD':
    case 'OPTIONS':
    case 'POST':
    case 'PUT':
      return upper
    default:
      return method
  }
}

const validateDirectReadMethod = (method: string): TypeError | undefined => {
  if (!methodTokenRegExp.test(method)) {
    return new TypeError(`'${method}' is not a valid HTTP method.`)
  }
  // Keep TRACE workaround behavior, but preserve native rejection for other
  // forbidden methods when using the direct-read fast path.
  // Only exact upper-case TRACE is treated as the existing workaround target.
  const normalized = method.toUpperCase()
  if (
    normalized === 'CONNECT' ||
    normalized === 'TRACK' ||
    (normalized === 'TRACE' && method !== 'TRACE')
  ) {
    return new TypeError(`'${method}' HTTP method is unsupported.`)
  }
  return undefined
}

const readBodyWithFastPath = <T>(
  request: Record<string | symbol, any>,
  method: DirectBodyReadMethod,
  fromBuffer: (buf: Buffer, request: Record<string | symbol, any>) => T | Promise<T>
): Promise<T> => {
  if (request[bodyConsumedDirectlyKey]) {
    return rejectBodyUnusable()
  }

  const methodName = request.method as string
  if (methodName === 'GET' || methodName === 'HEAD') {
    return request[getRequestCache]()[method]()
  }

  const methodValidationError = validateDirectReadMethod(methodName)
  if (methodValidationError) {
    return Promise.reject(methodValidationError)
  }

  if (request[requestCache]) {
    // Keep TRACE direct-read behavior stable even if non-body properties
    // created requestCache earlier (e.g. signal access).
    if (methodName !== 'TRACE') {
      const cachedRequest = request[requestCache] as Request
      return cachedRequest[method]() as Promise<T>
    }
  }

  const alreadyUsedError = consumeBodyDirectOnce(request)
  if (alreadyUsedError) {
    return alreadyUsedError
  }

  const raw = readRawBodyIfAvailable(request)
  if (raw) {
    const result = Promise.resolve(fromBuffer(raw, request))
    request[bodyBufferKey] = undefined
    return result
  }

  return readBodyDirect(request).then((buf) => {
    const result = fromBuffer(buf, request)
    request[bodyBufferKey] = undefined
    return result
  })
}

const readRawBodyIfAvailable = (request: Record<string | symbol, any>): Buffer | undefined => {
  const incoming = request[incomingKey] as IncomingMessage | Http2ServerRequest
  if ('rawBody' in incoming && (incoming as any).rawBody instanceof Buffer) {
    return (incoming as any).rawBody as Buffer
  }
  return undefined
}

// The error a body read fails with after an abort: the stream's own error if
// it has one, otherwise the abort reason recorded on the request, otherwise a
// generic disconnect error.
const normalizeAbortError = (
  request: Record<string | symbol, any>,
  incoming: IncomingMessage | Http2ServerRequest
): Error => {
  if (incoming.errored) {
    return incoming.errored
  }
  const reason = request[abortReasonKey]
  if (reason !== undefined) {
    return reason instanceof Error ? reason : new Error(String(reason))
  }
  return new Error('Client connection prematurely closed.')
}

// Read body directly from the IncomingMessage stream, bypassing Request object creation.
// Precondition: the caller (listener.ts) must ensure that the IncomingMessage stream is
// properly cleaned up (e.g. via incoming.resume()) when the response ends or the connection
// closes. This function does not call incoming.destroy() on abort.
const readBodyDirect = (request: Record<string | symbol, any>): Promise<Buffer> => {
  if (request[bodyBufferKey]) {
    return Promise.resolve(request[bodyBufferKey] as Buffer)
  }
  if (request[bodyReadPromiseKey]) {
    return request[bodyReadPromiseKey] as Promise<Buffer>
  }

  const incoming = request[incomingKey] as IncomingMessage | Http2ServerRequest
  if (incoming.readableDidRead) {
    return rejectBodyUnusable()
  }

  const buffered = readBodyBufferedBeforeDisconnect(incoming)
  if (buffered !== undefined) {
    if (buffered instanceof Error) {
      return Promise.reject(buffered)
    }
    request[bodyBufferKey] = buffered
    return Promise.resolve(buffered)
  }

  const promise = new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = []
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) {
        return
      }
      settled = true
      cleanup()
      callback()
    }

    // readBodyDirect started while the stream was untouched, so it owns every
    // chunk emitted from that point onward. If HTTP/1 parsing completed before
    // the connection closed, combine those chunks with anything still buffered
    // and treat the body as complete. Transport-level ECONNRESET is recoverable;
    // application-provided stream errors are not.
    const recoverCompleteBodyAfterDisconnect = (error?: unknown): boolean => {
      const streamError = incoming.errored ?? error
      if (
        !isRecoverableDisconnectedIncoming(incoming) ||
        (streamError && (streamError as NodeJS.ErrnoException).code !== 'ECONNRESET')
      ) {
        return false
      }

      finish(() => {
        const recovered = readBodyBufferedBeforeDisconnect(incoming, chunks)
        if (recovered instanceof Error) {
          reject(recovered)
        } else if (recovered === undefined) {
          reject(error ?? normalizeAbortError(request, incoming))
        } else {
          request[bodyBufferKey] = recovered
          resolve(recovered)
        }
      })
      return true
    }

    const onData = (chunk: Buffer | string) => {
      chunks.push(toBufferChunk(chunk, incoming.readableEncoding))
    }
    const onEnd = () => {
      finish(() => {
        const buffer = chunks.length === 1 ? chunks[0] : Buffer.concat(chunks)
        request[bodyBufferKey] = buffer
        resolve(buffer)
      })
    }
    const onError = (error: unknown) => {
      if (recoverCompleteBodyAfterDisconnect(error)) {
        return
      }
      finish(() => {
        reject(error)
      })
    }
    const onClose = () => {
      if (incoming.readableEnded) {
        onEnd()
        return
      }
      if (recoverCompleteBodyAfterDisconnect()) {
        return
      }
      finish(() => {
        reject(normalizeAbortError(request, incoming))
      })
    }
    const cleanup = () => {
      incoming.off('data', onData)
      incoming.off('end', onEnd)
      incoming.off('error', onError)
      incoming.off('close', onClose)
      request[bodyReadPromiseKey] = undefined
    }

    incoming.on('data', onData)
    incoming.on('end', onEnd)
    incoming.on('error', onError)
    incoming.on('close', onClose)

    // If the stream has already settled before listeners were attached,
    // no further events will fire, so resolve/reject from the current state.
    queueMicrotask(() => {
      if (settled) {
        return
      }
      if (incoming.readableEnded) {
        onEnd()
      } else if (incoming.errored) {
        onError(incoming.errored)
      } else if (incoming.destroyed) {
        onClose()
      }
    })
  })

  request[bodyReadPromiseKey] = promise
  return promise
}

const requestPrototype: Record<string | symbol, any> = {
  get method() {
    return this[methodKey]
  },

  get url() {
    return this[urlKey]
  },

  get headers() {
    return (this[headersKey] ||= newHeadersFromIncoming(this[incomingKey]))
  },

  [abortRequest](reason: unknown) {
    if (this[abortReasonKey] === undefined) {
      this[abortReasonKey] = reason
    }
    const abortController = this[abortControllerKey] as AbortController | undefined
    if (abortController && !abortController.signal.aborted) {
      abortController.abort(reason)
    }
  },

  [getAbortController]() {
    this[abortControllerKey] ||= new AbortController()
    if (this[abortReasonKey] !== undefined && !this[abortControllerKey].signal.aborted) {
      this[abortControllerKey].abort(this[abortReasonKey])
    }
    return this[abortControllerKey]
  },

  [getRequestCache]() {
    const abortController = this[getAbortController]()
    if (this[requestCache]) {
      return this[requestCache]
    }

    const method = this.method

    // If body was already consumed directly, create a minimal Request with an empty body
    // to avoid holding the body buffer in memory via ReadableStream re-wrapping.
    if (this[bodyConsumedDirectlyKey] && !(method === 'GET' || method === 'HEAD')) {
      this[bodyBufferKey] = undefined
      const init = {
        method: method === 'TRACE' ? 'GET' : method,
        headers: this.headers,
        signal: abortController.signal,
      } as RequestInit
      if (method !== 'TRACE') {
        init.body = new ReadableStream({
          start(c) {
            c.close()
          },
        })
        ;(init as any).duplex = 'half'
      }
      const req = new Request(this[urlKey], init)
      if (method === 'TRACE') {
        Object.defineProperty(req, 'method', {
          get() {
            return 'TRACE'
          },
        })
      }
      return (this[requestCache] = req)
    }

    return (this[requestCache] = newRequestFromIncoming(
      this.method,
      this[urlKey],
      this.headers,
      this[incomingKey],
      abortController
    ))
  },

  get body() {
    if (!this[bodyConsumedDirectlyKey]) {
      return this[getRequestCache]().body
    }
    const request = this[getRequestCache]()
    if (!this[bodyLockReaderKey] && request.body) {
      // Web standard requires body.locked === true when bodyUsed === true.
      // After direct consumption (text/json/arrayBuffer/blob), getRequestCache() returns
      // a Request with an empty ReadableStream body. We lock it here so that
      // body.locked reflects the consumed state correctly.
      this[bodyLockReaderKey] = request.body.getReader()
    }
    return request.body
  },

  get bodyUsed() {
    if (this[bodyConsumedDirectlyKey]) {
      return true
    }
    if (this[requestCache]) {
      return this[requestCache].bodyUsed
    }
    return false
  },
}

Object.defineProperty(requestPrototype, 'signal', {
  get() {
    return this[getAbortController]().signal
  },
})
;[
  'cache',
  'credentials',
  'destination',
  'integrity',
  'mode',
  'redirect',
  'referrer',
  'referrerPolicy',
  'keepalive',
].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    get() {
      return this[getRequestCache]()[k]
    },
  })
})
;['clone', 'formData'].forEach((k) => {
  Object.defineProperty(requestPrototype, k, {
    value: function () {
      if (this[bodyConsumedDirectlyKey]) {
        if (k === 'clone') {
          throw newBodyUnusableError()
        }
        return rejectBodyUnusable()
      }
      return this[getRequestCache]()[k]()
    },
  })
})

// Direct body reading for text/arrayBuffer/blob/json: bypass getRequestCache()
// → new AbortController() → newHeadersFromIncoming() → new Request(url, init)
// → Readable.toWeb() chain for common body parsing cases.
Object.defineProperty(requestPrototype, 'text', {
  value: function (): Promise<string> {
    return readBodyWithFastPath(this, 'text', (buf) => textDecoder.decode(buf))
  },
})
Object.defineProperty(requestPrototype, 'arrayBuffer', {
  value: function (): Promise<ArrayBuffer> {
    return readBodyWithFastPath(this, 'arrayBuffer', (buf) => toArrayBuffer(buf))
  },
})
Object.defineProperty(requestPrototype, 'blob', {
  value: function (): Promise<Blob> {
    return readBodyWithFastPath(this, 'blob', (buf, request) => {
      const type = contentType(request)
      const init = type ? { headers: { 'content-type': type } } : undefined
      return new Response(buf, init).blob()
    })
  },
})
// json() reuses text() fast path to keep body consumption logic centralized.
Object.defineProperty(requestPrototype, 'json', {
  value: function (): Promise<any> {
    if (this[bodyConsumedDirectlyKey]) {
      return rejectBodyUnusable()
    }
    return this.text().then(JSON.parse)
  },
})

Object.defineProperty(requestPrototype, Symbol.for('nodejs.util.inspect.custom'), {
  value: function (depth: number, options: object, inspectFn: Function) {
    const props: Record<string, unknown> = {
      method: this.method,
      url: this.url,
      headers: this.headers,
      nativeRequest: this[requestCache],
    }

    return `Request (lightweight) ${inspectFn(props, { ...options, depth: depth == null ? null : depth - 1 })}`
  },
})

Object.setPrototypeOf(requestPrototype, Request.prototype)

export const newRequest = (
  incoming: IncomingMessage | Http2ServerRequest,
  defaultHostname?: string
) => {
  const req = Object.create(requestPrototype)
  req[incomingKey] = incoming
  req[methodKey] = normalizeIncomingMethod(incoming.method)

  const incomingUrl = incoming.url || ''

  // handle absolute URL in request.url
  if (
    incomingUrl[0] !== '/' && // short-circuit for performance. most requests are relative URL.
    (incomingUrl.startsWith('http://') || incomingUrl.startsWith('https://'))
  ) {
    if (incoming instanceof Http2ServerRequest) {
      throw new RequestError('Absolute URL for :path is not allowed in HTTP/2') // RFC 9113 8.3.1.
    }

    try {
      const url = new URL(incomingUrl)
      req[urlKey] = url.href
    } catch (e) {
      throw new RequestError('Invalid absolute URL', { cause: e })
    }

    return req
  }

  // Otherwise, relative URL
  const host =
    (incoming instanceof Http2ServerRequest ? incoming.authority : incoming.headers.host) ||
    defaultHostname
  if (!host) {
    throw new RequestError('Missing host header')
  }

  let scheme: string
  if (incoming instanceof Http2ServerRequest) {
    scheme = incoming.scheme
    if (!(scheme === 'http' || scheme === 'https')) {
      throw new RequestError('Unsupported scheme')
    }
  } else {
    scheme = incoming.socket && (incoming.socket as TLSSocket).encrypted ? 'https' : 'http'
  }

  try {
    req[urlKey] = buildUrl(scheme, host, incomingUrl)
  } catch (e) {
    if (e instanceof RequestError) {
      throw e
    } else {
      throw new RequestError('Invalid URL', { cause: e })
    }
  }

  return req
}
