import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import {
  abortControllerKey,
  newRequest,
  Request as LightweightRequest,
  toRequestError,
} from './request'
import { cacheKey, Response as LightweightResponse } from './response'
import type { InternalCache } from './response'
import type { CustomErrorHandler, FetchCallback, HttpBindings } from './types'
import { writeFromReadableStream, buildOutgoingHttpHeaders } from './utils'
import { X_ALREADY_SENT } from './utils/response/constants'
import './globals'

const regBuffer = /^no$/i
const regContentType = /^(application\/json\b|text\/(?!event-stream\b))/i

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
    return writeFromReadableStream(body, outgoing)?.catch(
      (e) => handleResponseError(e, outgoing) as undefined
    )
  }
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
    /**
     * If content-encoding is set, we assume that the response should be not decoded.
     * Else if transfer-encoding is set, we assume that the response should be streamed.
     * Else if content-length is set, we assume that the response content has been taken care of.
     * Else if x-accel-buffering is set to no, we assume that the response should be streamed.
     * Else if content-type is not application/json nor text/* but can be text/event-stream,
     * we assume that the response should be streamed.
     */

    const {
      'transfer-encoding': transferEncoding,
      'content-encoding': contentEncoding,
      'content-length': contentLength,
      'x-accel-buffering': accelBuffering,
      'content-type': contentType,
    } = resHeaderRecord

    if (
      transferEncoding ||
      contentEncoding ||
      contentLength ||
      // nginx buffering variant
      (accelBuffering && regBuffer.test(accelBuffering as string)) ||
      !regContentType.test(contentType as string)
    ) {
      outgoing.writeHead(res.status, resHeaderRecord)
      flushHeaders(outgoing)

      await writeFromReadableStream(res.body, outgoing)
    } else {
      const buffer = await res.arrayBuffer()
      resHeaderRecord['content-length'] = buffer.byteLength

      outgoing.writeHead(res.status, resHeaderRecord)
      outgoing.end(new Uint8Array(buffer))
    }
  } else if (resHeaderRecord[X_ALREADY_SENT]) {
    // do nothing, the response has already been sent
  } else {
    outgoing.writeHead(res.status, resHeaderRecord)
    outgoing.end()
  }
}

export const getRequestListener = (
  fetchCallback: FetchCallback,
  options: {
    hostname?: string
    errorHandler?: CustomErrorHandler
    overrideGlobalObjects?: boolean
  } = {}
) => {
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

      // Detect if request was aborted.
      outgoing.on('close', () => {
        const abortController = req[abortControllerKey] as AbortController | undefined
        if (!abortController) {
          return
        }

        if (incoming.errored) {
          req[abortControllerKey].abort(incoming.errored.toString())
        } else if (!outgoing.writableFinished) {
          req[abortControllerKey].abort('Client connection prematurely closed.')
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
