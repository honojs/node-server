import type { Writable } from 'node:stream'

// get the nodejs Response internal kState symbol
const kState = Reflect.ownKeys(new Response()).find(k => typeof k !== 'string' && k.toString() === 'Symbol(state)') as symbol | undefined

/**
 * For a performance reason, we need to get the internal body of a Response
 * to avoid creating another body stream for the proxy response.
 * 
 * Topic @see https://github.com/honojs/node-server/pull/95#issuecomment-1815717667
 */
export function getResponseInternalBody(response: Response) {
  if (!kState || !response || !response.body) return

  const state = (response as any)[kState]
  if (!state || !state.body) return

  return state.body as {
    source: string | Uint8Array | FormData | Blob | null
    stream: ReadableStream
    length: number | null
  }
}

export function writeFromReadableStream(stream: ReadableStream<Uint8Array>, writable: Writable) {
  if (stream.locked) {
    throw new TypeError('ReadableStream is locked.')
  } else if (writable.destroyed) {
    stream.cancel();
    return Promise.resolve()
  }
  const reader = stream.getReader()
  writable.on('close', cancel)
  writable.on('error', cancel)
  reader.read().then(flow, cancel)
  return reader.closed.finally(() => {
    writable.off('close', cancel)
    writable.off('error', cancel)
  })
  function cancel(error?: any) {
    reader.cancel(error).catch(() => {})
    if (error) writable.destroy(error)
  }
  function onDrain() {
    reader.read().then(flow, cancel)
  }
  function flow({ done, value }: ReadableStreamReadResult<Uint8Array>): void | Promise<void> {
    try {
      if (done) {
        writable.end()
      } else if (!writable.write(value)) {
        writable.once("drain", onDrain);
      } else {
        return reader.read().then(flow, cancel)
      }
    } catch (e) {
      cancel(e)
    }
  }
}
