import type { Writable } from 'node:stream'

export async function writeReadableStreamToWritable(stream: ReadableStream, writable: Writable) {
  const reader = stream.getReader()

  function onClose() {
    reader.cancel(new Error('Response writer closed'))
  }

  writable.once('close', onClose)

  try {
    while (true) {
      const { done, value } = await reader.read()

      if (done) {
        writable.end()
        return
      }

      writable.write(value)
    }
  } finally {
    writable.off('close', onClose)
    reader.releaseLock()
  }
}
