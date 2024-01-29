import type { IncomingMessage, ServerResponse, OutgoingHttpHeaders } from 'node:http'
import type { Http2ServerRequest, Http2ServerResponse } from 'node:http2'
import { newRequest } from './request'
import { cacheKey } from './response'
import type { FetchCallback } from './types'
import { writeFromReadableStream, buildOutgoingHttpHeaders } from './utils'
import './globals'

const regBuffer = /^no$/i
const regContentType = /^(application\/json\b|text\/(?!event-stream\b))/i

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
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'Content-Type': 'text/plain' })
    outgoing.end(`Error: ${err.message}`)
    outgoing.destroy(err)
  }
}

const responseViaCache = (
  res: Response,
  outgoing: ServerResponse | Http2ServerResponse
): undefined | Promise<undefined> => {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [status, body, header] = (res as any)[cacheKey]
  if (typeof body === 'string') {
    header['Content-Length'] = Buffer.byteLength(body)
    outgoing.writeHead(status, header)
    outgoing.end(body)
  } else {
    outgoing.writeHead(status, header)
    return writeFromReadableStream(body, outgoing)?.catch(
      (e) => handleResponseError(e, outgoing) as undefined
    )
  }
}

const responseViaResponseObject = async (
  res: Response | Promise<Response>,
  outgoing: ServerResponse | Http2ServerResponse,
  options: { errorHandler?: (e: unknown) => void } = {}
) => {
  if (res instanceof Promise) {
    if (options.errorHandler) {
      try {
        res = await res
      } catch (err) {
        return options.errorHandler(err)
      }
    } else {
      res = await res.catch(handleFetchError)
    }
  }

  try {
    if (cacheKey in res) {
      return responseViaCache(res as Response, outgoing)
    }
  } catch (e: unknown) {
    return handleResponseError(e, outgoing)
  }

  const resHeaderRecord: OutgoingHttpHeaders = buildOutgoingHttpHeaders(res.headers)

  if (res.body) {
    try {
      /**
       * If content-encoding is set, we assume that the response should be not decoded.
       * Else if transfer-encoding is set, we assume that the response should be streamed.
       * Else if content-length is set, we assume that the response content has been taken care of.
       * Else if x-accel-buffering is set to no, we assume that the response should be streamed.
       * Else if content-type is not application/json nor text/* but can be text/event-stream,
       * we assume that the response should be streamed.
       */
      if (
        resHeaderRecord['transfer-encoding'] ||
        resHeaderRecord['content-encoding'] ||
        resHeaderRecord['content-length'] ||
        // nginx buffering variant
        (resHeaderRecord['x-accel-buffering'] &&
          regBuffer.test(resHeaderRecord['x-accel-buffering'] as string)) ||
        !regContentType.test(resHeaderRecord['content-type'] as string)
      ) {
        outgoing.writeHead(res.status, resHeaderRecord)
        await writeFromReadableStream(res.body, outgoing)
      } else {
        const buffer = await res.arrayBuffer()
        resHeaderRecord['content-length'] = buffer.byteLength
        outgoing.writeHead(res.status, resHeaderRecord)
        outgoing.end(new Uint8Array(buffer))
      }
    } catch (e: unknown) {
      handleResponseError(e, outgoing)
    }
  } else {
    outgoing.writeHead(res.status, resHeaderRecord)
    outgoing.end()
  }
}

export const getRequestListener = (
  fetchCallback: FetchCallback,
  options: { errorHandler?: (e: unknown) => void } = {}
) => {
  return (
    incoming: IncomingMessage | Http2ServerRequest,
    outgoing: ServerResponse | Http2ServerResponse
  ) => {
    let res

    // `fetchCallback()` requests a Request object, but global.Request is expensive to generate,
    // so generate a pseudo Request object with only the minimum required information.
    const req = newRequest(incoming)

    try {
      res = fetchCallback(req) as Response | Promise<Response>
      if (cacheKey in res) {
        // synchronous, cacheable response
        return responseViaCache(res as Response, outgoing)
      }
    } catch (e: unknown) {
      if (!res) {
        if (options.errorHandler) {
          return options.errorHandler(e)
        }

        res = handleFetchError(e)
      } else {
        return handleResponseError(e, outgoing)
      }
    }

    return responseViaResponseObject(res, outgoing, options)
  }
}
