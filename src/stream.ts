import type { Writable } from 'node:stream'

export async function writeReadableStreamToWritable(stream: ReadableStream, writable: Writable) {
  let reader = stream.getReader()

  async function read() {
    let { done, value } = await reader.read()

    if (done) {
      writable.end()
      return
    }

    writable.write(value)

    await read()
  }

  try {
    await read()
  } catch (error: any) {
    writable.destroy(error)
    throw error
  }
}

/**
 * Credits:
 *   - https://github.com/remix-run/remix/blob/e77e2eb/packages/remix-node/stream.ts
 */
