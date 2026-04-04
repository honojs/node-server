import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import { Http2ServerRequest, constants as h2constants } from 'node:http2'
import type { Http2ServerResponse } from 'node:http2'
import type { Writable } from 'node:stream'
import type { IncomingMessageWithWrapBodyStream } from './request'
import {
  abortRequest,
  newRequest,
  Request as LightweightRequest,
  wrapBodyStream,
  toRequestError,
} from './request'
import { defaultContentType, cacheKey, Response as LightweightResponse } from './response'
import type { InternalCache } from './response'
import type { CustomErrorHandler, FetchCallback, HttpBindings } from './types'
import {
  readWithoutBlocking,
  writeFromReadableStream,
  writeFromReadableStreamDefaultReader,
  buildOutgoingHttpHeaders,
} from './utils'
import { X_ALREADY_SENT } from './utils/response/constants'

const outgoingEnded = Symbol('outgoingEnded')
const incomingDraining = Symbol('incomingDraining')
type OutgoingHasOutgoingEnded = Http2ServerResponse & {
  [outgoingEnded]?: () => void
}
type IncomingHasDrainState = (IncomingMessage | Http2ServerRequest) & {
  [incomingDraining]?: boolean
}

const DRAIN_TIMEOUT_MS = 500
const MAX_DRAIN_BYTES = 64 * 1024 * 1024

const drainIncoming = (incoming: IncomingMessage | Http2ServerRequest): void => {
  const incomingWithDrainState = incoming as IncomingHasDrainState
  if (incoming.destroyed || incomingWithDrainState[incomingDraining]) {
    return
  }
  incomingWithDrainState[incomingDraining] = true

  // HTTP/2: streams are multiplexed, so we can close immediately
  // without risking TCP RST racing the response.
  if (incoming instanceof Http2ServerRequest) {
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ;(incoming as any).stream?.close?.(h2constants.NGHTTP2_NO_ERROR)
    } catch {
      // stream may already be closed
    }
    return
  }

  let bytesRead = 0
  const cleanup = () => {
    clearTimeout(timer)
    incoming.off('data', onData)
    incoming.off('end', cleanup)
    incoming.off('error', cleanup)
  }

  const forceClose = () => {
    cleanup()
    const socket = incoming.socket
    if (socket && !socket.destroyed) {
      socket.destroySoon()
    }
  }

  const timer = setTimeout(forceClose, DRAIN_TIMEOUT_MS)
  timer.unref?.()

  const onData = (chunk: Buffer) => {
    bytesRead += chunk.length
    if (bytesRead > MAX_DRAIN_BYTES) {
      forceClose()
    }
  }

  incoming.on('data', onData)
  incoming.on('end', cleanup)
  incoming.on('error', cleanup)

  incoming.resume()
}

const makeCloseHandler =
  (
    req: any,
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: ServerResponse | Http2ServerResponse,
    needsBodyCleanup: boolean
  ): (() => void) =>
  () => {
    if (incoming.errored) {
      req[abortRequest](incoming.errored.toString())
    } else if (!outgoing.writableFinished) {
      req[abortRequest]('Client connection prematurely closed.')
    }

    if (needsBodyCleanup && !incoming.readableEnded) {
      setTimeout(() => {
        if (!incoming.readableEnded) {
          setTimeout(() => {
            drainIncoming(incoming)
          })
        }
      })
    }
  }

const handleRequestError = (): Response =>
  new Response(null, {
    status: 400,
  })

const handleFetchError = (e: unknown): Response =>
  new Response(null, {
    status:
      e instanceof Error && (e.name === 'TimeoutError' || e.constructor.name === 'TimeoutError')
        ? 504 // timeout error emits 504 timeout
        : 500,
  })

const handleResponseError = (e: unknown, outgoing: ServerResponse | Http2ServerResponse) => {
  const err = (e instanceof Error ? e : new Error('unknown error', { cause: e })) as Error & {
    code: string
  }
  if (err.code === 'ERR_STREAM_PREMATURE_CLOSE') {
    console.info('The user aborted a request.')
  } else {
    console.error(e)
    if (!outgoing.headersSent) {
      outgoing.writeHead(500, { 'Content-Type': 'text/plain' })
    }
    outgoing.end(`Error: ${err.message}`)
    outgoing.destroy(err)
  }
}

const flushHeaders = (outgoing: ServerResponse | Http2ServerResponse) => {
  // If outgoing is ServerResponse (HTTP/1.1), it requires this to flush headers.
  // However, Http2ServerResponse is sent without this.
  if ('flushHeaders' in outgoing && outgoing.writable) {
    outgoing.flushHeaders()
  }
}

const responseViaCache = async (
  res: Response,
  outgoing: ServerResponse | Http2ServerResponse
): Promise<undefined | void> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let [status, body, header] = (res as any)[cacheKey] as InternalCache

  // Fast path: no custom headers — create the final header object in one shot
  // (avoids shape transitions from mutating a single-key object).
  if (!header) {
    if (body == null) {
      outgoing.writeHead(status, {})
      outgoing.end()
    } else if (typeof body === 'string') {
      outgoing.writeHead(status, {
        'Content-Type': defaultContentType,
        'Content-Length': Buffer.byteLength(body),
      })
      outgoing.end(body)
    } else if (body instanceof Uint8Array) {
      outgoing.writeHead(status, {
        'Content-Type': defaultContentType,
        'Content-Length': body.byteLength,
      })
      outgoing.end(body)
    } else if (body instanceof Blob) {
      outgoing.writeHead(status, {
        'Content-Type': defaultContentType,
        'Content-Length': body.size,
      })
      outgoing.end(new Uint8Array(await body.arrayBuffer()))
    } else {
      outgoing.writeHead(status, { 'Content-Type': defaultContentType })
      flushHeaders(outgoing)
      await writeFromReadableStream(body, outgoing)?.catch(
        (e) => handleResponseError(e, outgoing) as undefined
      )
    }
    ;(outgoing as OutgoingHasOutgoingEnded)[outgoingEnded]?.()
    return
  }

  let hasContentLength = false
  if (header instanceof Headers) {
    hasContentLength = header.has('content-length')
    header = buildOutgoingHttpHeaders(header, body === null ? undefined : defaultContentType)
  } else if (Array.isArray(header)) {
    const headerObj = new Headers(header)
    hasContentLength = headerObj.has('content-length')
    header = buildOutgoingHttpHeaders(headerObj, body === null ? undefined : defaultContentType)
  } else {
    for (const key in header) {
      if (key.length === 14 && key.toLowerCase() === 'content-length') {
        hasContentLength = true
        break
      }
    }
  }

  // in `responseViaCache`, if body is not stream, Transfer-Encoding is considered not chunked
  if (!hasContentLength) {
    if (typeof body === 'string') {
      header['Content-Length'] = Buffer.byteLength(body)
    } else if (body instanceof Uint8Array) {
      header['Content-Length'] = body.byteLength
    } else if (body instanceof Blob) {
      header['Content-Length'] = body.size
    }
  }

  outgoing.writeHead(status, header)
  if (body == null) {
    outgoing.end()
  } else if (typeof body === 'string' || body instanceof Uint8Array) {
    outgoing.end(body)
  } else if (body instanceof Blob) {
    outgoing.end(new Uint8Array(await body.arrayBuffer()))
  } else {
    flushHeaders(outgoing)
    await writeFromReadableStream(body, outgoing)?.catch(
      (e) => handleResponseError(e, outgoing) as undefined
    )
  }

  ;(outgoing as OutgoingHasOutgoingEnded)[outgoingEnded]?.()
}

const isPromise = (res: Response | Promise<Response>): res is Promise<Response> =>
  typeof (res as Promise<Response>).then === 'function'

const responseViaResponseObject = async (
  res: Response | Promise<Response>,
  outgoing: ServerResponse | Http2ServerResponse,
  options: { errorHandler?: CustomErrorHandler } = {}
) => {
  if (isPromise(res)) {
    if (options.errorHandler) {
      try {
        res = await res
      } catch (err) {
        const errRes = await options.errorHandler(err)
        if (!errRes) {
          return
        }
        res = errRes
      }
    } else {
      res = await res.catch(handleFetchError)
    }
  }

  if (cacheKey in res) {
    return responseViaCache(res as Response, outgoing)
  }

  const resHeaderRecord: OutgoingHttpHeaders = buildOutgoingHttpHeaders(
    res.headers,
    res.body === null ? undefined : defaultContentType
  )

  if (res.body) {
    const reader = res.body.getReader()

    const values: Uint8Array[] = []
    let done = false
    let currentReadPromise: Promise<ReadableStreamReadResult<Uint8Array>> | undefined = undefined

    if (resHeaderRecord['transfer-encoding'] !== 'chunked') {
      // In the case of synchronous responses, usually a maximum of two (or three in special cases) readings is done
      let maxReadCount = 2
      for (let i = 0; i < maxReadCount; i++) {
        currentReadPromise ||= reader.read()
        const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
          console.error(e)
          done = true
        })
        if (!chunk) {
          if (i === 1) {
            // XXX: In Node.js v24, some response bodies are not read all the way through until the next task queue,
            // so wait a moment and retry. (e.g. new Blob([new Uint8Array(contents)]) )
            await new Promise((resolve) => setTimeout(resolve))
            maxReadCount = 3
            continue
          }

          // Error occurred or currentReadPromise is not yet resolved.
          // If an error occurs, immediately break the loop.
          // If currentReadPromise is not yet resolved, pass it to writeFromReadableStreamDefaultReader.
          break
        }
        currentReadPromise = undefined

        if (chunk.value) {
          values.push(chunk.value)
        }
        if (chunk.done) {
          done = true
          break
        }
      }

      if (done && !('content-length' in resHeaderRecord)) {
        resHeaderRecord['content-length'] = values.reduce((acc, value) => acc + value.length, 0)
      }
    }

    outgoing.writeHead(res.status, resHeaderRecord)
    values.forEach((value) => {
      ;(outgoing as Writable).write(value)
    })
    if (done) {
      outgoing.end()
    } else {
      if (values.length === 0) {
        flushHeaders(outgoing)
      }
      await writeFromReadableStreamDefaultReader(reader, outgoing, currentReadPromise)
    }
  } else if (resHeaderRecord[X_ALREADY_SENT]) {
    // do nothing, the response has already been sent
  } else {
    outgoing.writeHead(res.status, resHeaderRecord)
    outgoing.end()
  }

  ;(outgoing as OutgoingHasOutgoingEnded)[outgoingEnded]?.()
}

export const getRequestListener = (
  fetchCallback: FetchCallback,
  options: {
    hostname?: string
    errorHandler?: CustomErrorHandler
    overrideGlobalObjects?: boolean
    autoCleanupIncoming?: boolean
  } = {}
) => {
  const autoCleanupIncoming = options.autoCleanupIncoming ?? true
  if (options.overrideGlobalObjects !== false && global.Request !== LightweightRequest) {
    Object.defineProperty(global, 'Request', {
      value: LightweightRequest,
    })
    Object.defineProperty(global, 'Response', {
      value: LightweightResponse,
    })
  }

  return async (
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: ServerResponse | Http2ServerResponse
  ) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let res, req: any
    let needsBodyCleanup = false

    try {
      // `fetchCallback()` requests a Request object, but global.Request is expensive to generate,
      // so generate a pseudo Request object with only the minimum required information.
      req = newRequest(incoming, options.hostname)

      // For non-GET/HEAD requests, mark for body stream wrapping and H2 cleanup.
      needsBodyCleanup =
        autoCleanupIncoming && !(incoming.method === 'GET' || incoming.method === 'HEAD')
      if (needsBodyCleanup) {
        ;(incoming as IncomingMessageWithWrapBodyStream)[wrapBodyStream] = true

        if (incoming instanceof Http2ServerRequest) {
          // a Http2ServerResponse instance requires additional processing on exit
          // since outgoing.on('close') is not called even after outgoing.end() is called
          // when the state is incomplete
          ;(outgoing as OutgoingHasOutgoingEnded)[outgoingEnded] = () => {
            // incoming is not consumed to the end
            if (!incoming.readableEnded) {
              setTimeout(() => {
                // in the case of a simple POST request, the cleanup process may be done automatically
                // and readableEnded is true at this point. At that point, nothing is done.
                if (!incoming.readableEnded) {
                  setTimeout(() => {
                    incoming.destroy()
                    // a Http2ServerResponse instance will not terminate without also calling outgoing.destroy()
                    outgoing.destroy()
                  })
                }
              })
            }
          }
        }
      }

      res = fetchCallback(req, { incoming, outgoing } as HttpBindings) as
        | Response
        | Promise<Response>
      if (cacheKey in res) {
        // Synchronous cacheable response — no close listener needed.
        // No I/O events can fire between fetchCallback returning and responseViaCache
        // completing, so abort detection is not needed here.
        if (needsBodyCleanup && !incoming.readableEnded) {
          // Handler returned without consuming the body; drain after the
          // response is flushed so the socket is freed gracefully (avoids
          // TCP RST racing the response for HTTP/1, and RST_STREAM for HTTP/2).
          outgoing.once('finish', () => {
            if (!incoming.readableEnded) {
              drainIncoming(incoming)
            }
          })
        }
        return responseViaCache(res as Response, outgoing)
      }
      // Async response — create and register close listener only now, avoiding
      // closure allocation on the synchronous hot path.
      outgoing.on('close', makeCloseHandler(req, incoming, outgoing, needsBodyCleanup))
    } catch (e: unknown) {
      if (!res) {
        if (options.errorHandler) {
          // Async error handler — register close listener so client disconnect aborts the signal.
          if (req) {
            outgoing.on('close', makeCloseHandler(req, incoming, outgoing, needsBodyCleanup))
          }
          res = await options.errorHandler(req ? e : toRequestError(e))
          if (!res) {
            return
          }
        } else if (!req) {
          res = handleRequestError()
        } else {
          res = handleFetchError(e)
        }
      } else {
        return handleResponseError(e, outgoing)
      }
    }

    try {
      return await responseViaResponseObject(res, outgoing, options)
    } catch (e) {
      return handleResponseError(e, outgoing)
    }
  }
}
