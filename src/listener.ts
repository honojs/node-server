import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import { Http2ServerRequest } from 'node:http2'
import type { Http2ServerResponse } from 'node:http2'
import type { Writable } from 'node:stream'
import type { IncomingMessageWithWrapBodyStream } from './request'
import {
  abortControllerKey,
  newRequest,
  Request as LightweightRequest,
  wrapBodyStream,
  toRequestError,
} from './request'
import { cacheKey, Response as LightweightResponse } from './response'
import type { InternalCache } from './response'
import type { CustomErrorHandler, FetchCallback, HttpBindings } from './types'
import {
  readWithoutBlocking,
  writeFromReadableStream,
  writeFromReadableStreamDefaultReader,
  buildOutgoingHttpHeaders,
} from './utils'
import { X_ALREADY_SENT } from './utils/response/constants'
import './globals'

const outgoingEnded = Symbol('outgoingEnded')
type OutgoingHasOutgoingEnded = Http2ServerResponse & {
  [outgoingEnded]?: () => void
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
  if (header instanceof Headers) {
    header = buildOutgoingHttpHeaders(header)
  }

  if (typeof body === 'string') {
    header['Content-Length'] = Buffer.byteLength(body)
  } else if (body instanceof Uint8Array) {
    header['Content-Length'] = body.byteLength
  } else if (body instanceof Blob) {
    header['Content-Length'] = body.size
  }

  outgoing.writeHead(status, header)
  if (typeof body === 'string' || body instanceof Uint8Array) {
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

const responseViaResponseObject = async (
  res: Response | Promise<Response>,
  outgoing: ServerResponse | Http2ServerResponse,
  options: { errorHandler?: CustomErrorHandler } = {}
) => {
  if (res instanceof Promise) {
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

  const resHeaderRecord: OutgoingHttpHeaders = buildOutgoingHttpHeaders(res.headers)

  if (res.body) {
    const reader = res.body.getReader()

    const values: Uint8Array[] = []
    let done = false
    let currentReadPromise: Promise<ReadableStreamReadResult<Uint8Array>> | undefined = undefined

    // In the case of synchronous responses, usually a maximum of two readings is done
    for (let i = 0; i < 2; i++) {
      currentReadPromise = reader.read()
      const chunk = await readWithoutBlocking(currentReadPromise).catch((e) => {
        console.error(e)
        done = true
      })
      if (!chunk) {
        if (i === 1 && resHeaderRecord['transfer-encoding'] !== 'chunked') {
          // XXX: In Node.js v24, some response bodies are not read all the way through until the next task queue,
          // so wait a moment and retry. (e.g. new Blob([new Uint8Array(contents)]) )
          await new Promise((resolve) => setTimeout(resolve))
          i--
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

    try {
      // `fetchCallback()` requests a Request object, but global.Request is expensive to generate,
      // so generate a pseudo Request object with only the minimum required information.
      req = newRequest(incoming, options.hostname)

      let incomingEnded =
        !autoCleanupIncoming || incoming.method === 'GET' || incoming.method === 'HEAD'
      if (!incomingEnded) {
        ;(incoming as IncomingMessageWithWrapBodyStream)[wrapBodyStream] = true
        incoming.on('end', () => {
          incomingEnded = true
        })

        if (incoming instanceof Http2ServerRequest) {
          // a Http2ServerResponse instance requires additional processing on exit
          // since outgoing.on('close') is not called even after outgoing.end() is called
          // when the state is incomplete
          ;(outgoing as OutgoingHasOutgoingEnded)[outgoingEnded] = () => {
            // incoming is not consumed to the end
            if (!incomingEnded) {
              setTimeout(() => {
                // in the case of a simple POST request, the cleanup process may be done automatically
                // and end is called at this point. At that point, nothing is done.
                if (!incomingEnded) {
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

      // Detect if request was aborted.
      outgoing.on('close', () => {
        const abortController = req[abortControllerKey] as AbortController | undefined
        if (abortController) {
          if (incoming.errored) {
            req[abortControllerKey].abort(incoming.errored.toString())
          } else if (!outgoing.writableFinished) {
            req[abortControllerKey].abort('Client connection prematurely closed.')
          }
        }

        // incoming is not consumed to the end
        if (!incomingEnded) {
          setTimeout(() => {
            // in the case of a simple POST request, the cleanup process may be done automatically
            // and end is called at this point. At that point, nothing is done.
            if (!incomingEnded) {
              setTimeout(() => {
                incoming.destroy()
              })
            }
          })
        }
      })

      res = fetchCallback(req, { incoming, outgoing } as HttpBindings) as
        | Response
        | Promise<Response>
      if (cacheKey in res) {
        // synchronous, cacheable response
        return responseViaCache(res as Response, outgoing)
      }
    } catch (e: unknown) {
      if (!res) {
        if (options.errorHandler) {
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
