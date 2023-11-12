import type { Writable } from 'node:stream'

export async function writeFromReadableStream(
  stream: ReadableStream<Uint8Array>,
  writable: Writable
) {
  if (stream.locked) {
    throw new TypeError('ReadableStream is locked.')
  }
  const reader = stream.getReader()
  if (writable.destroyed) {
    reader.cancel()
    return
  }
  writable.on('drain', onDrain)
  writable.on('close', cancel)
  writable.on('error', cancel)
  reader.read().then(flow, errorFlow)
  return reader.closed
    .catch((err) => {
      writable.destroy(err)
    })
    .finally(() => {
      writable.off('close', cancel)
      writable.off('error', cancel)
      writable.off('drain', onDrain)
    })
  function cancel(error?: Error) {
    reader.cancel(error).catch(() => {})
    if (error) writable.destroy(error)
  }
  function onDrain() {
    reader.read().then(flow, errorFlow)
  }
  function flow({ done, value }: ReadableStreamReadResult<Uint8Array>): void | Promise<void> {
    if (done) {
      if (!writable.writableEnded) {
        writable.end()
      }
    } else if (writable.write(value)) {
      return reader.read().then(flow, errorFlow)
    }
  }
  function errorFlow(err: any) {
    cancel(err)
  }
}
