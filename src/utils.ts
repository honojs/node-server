import type { OutgoingHttpHeaders } from 'node:http'
import type { Writable } from 'node:stream'

export async function readWithoutBlocking(
  readPromise: Promise<ReadableStreamReadResult<Uint8Array>>
): Promise<ReadableStreamReadResult<Uint8Array> | undefined> {
  return Promise.race([readPromise, Promise.resolve().then(() => Promise.resolve(undefined))])
}

export function writeFromReadableStreamDefaultReader(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  writable: Writable,
  currentReadPromise?: Promise<ReadableStreamReadResult<Uint8Array>> | undefined
) {
  const handleError = () => {
    // ignore the error
  }

  writable.on('error', handleError)
  ;(currentReadPromise ?? reader.read()).then(flow, handleStreamError)

  return reader.closed.finally(() => {
    writable.off('error', handleError)
  })

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function handleStreamError(error: any) {
    if (error) {
      writable.destroy(error)
    }
  }

  function onDrain() {
    reader.read().then(flow, handleStreamError)
  }

  function flow({ done, value }: ReadableStreamReadResult<Uint8Array>): void | Promise<void> {
    try {
      if (done) {
        writable.end()
      } else if (!writable.write(value)) {
        writable.once('drain', onDrain)
      } else {
        return reader.read().then(flow, handleStreamError)
      }
    } catch (e) {
      handleStreamError(e)
    }
  }
}

export function writeFromReadableStream(stream: ReadableStream<Uint8Array>, writable: Writable) {
  if (stream.locked) {
    throw new TypeError('ReadableStream is locked.')
  } else if (writable.destroyed) {
    return
  }

  return writeFromReadableStreamDefaultReader(stream.getReader(), writable)
}

export const buildOutgoingHttpHeaders = (
  headers: Headers | HeadersInit | null | undefined
): OutgoingHttpHeaders => {
  const res: OutgoingHttpHeaders = {}
  if (!(headers instanceof Headers)) {
    headers = new Headers(headers ?? undefined)
  }

  const cookies = []
  for (const [k, v] of headers) {
    if (k === 'set-cookie') {
      cookies.push(v)
    } else {
      res[k] = v
    }
  }
  if (cookies.length > 0) {
    res['set-cookie'] = cookies
  }
  res['content-type'] ??= 'text/plain; charset=UTF-8'

  return res
}
