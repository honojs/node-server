import type { ReadStream } from 'node:fs'
import { versions } from 'node:process'
import { Readable } from 'node:stream'

// In Node.js versions that do not have the following PR applied, using Readable.toWeb may cause unexpected exceptions.
// https://github.com/nodejs/node/pull/54206
const pr54206Applied = () => {
  const [major, minor] = versions.node.split('.').map((component) => parseInt(component))
  return major >= 23 || (major === 22 && minor >= 7) || (major === 20 && minor >= 18)
}
const useReadableToWeb = pr54206Applied()

export const createStreamBody = (
  stream: ReadStream,
  useNativeReadableToWeb = useReadableToWeb
): ReadableStream<Uint8Array> => {
  if (useNativeReadableToWeb) {
    return Readable.toWeb(stream) as ReadableStream<Uint8Array>
  }

  let controller: ReadableStreamDefaultController<Uint8Array> | undefined
  let settled = false

  const cleanup = () => {
    stream.off('data', onData)
    stream.off('error', onError)
    stream.off('end', onTerminate)
    stream.off('close', onTerminate)
  }

  const settle = (callback?: () => void) => {
    if (settled) {
      return
    }
    settled = true
    cleanup()
    callback?.()
  }

  const onData = (chunk: Buffer | string) => {
    if (settled || !controller) {
      return
    }
    // createReadStream is called without `encoding`, so chunks are always Buffer.
    controller.enqueue(chunk as Buffer)
    if ((controller.desiredSize ?? 0) <= 0) {
      stream.pause()
    }
  }

  const onError = (error: Error) => {
    settle(() => {
      controller?.error(error)
    })
  }

  const onTerminate = () => {
    settle(() => {
      controller?.close()
    })
  }

  return new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController
      stream.on('data', onData)
      stream.on('error', onError)
      stream.on('end', onTerminate)
      stream.on('close', onTerminate)
      stream.pause()
    },

    pull() {
      if (!settled) {
        stream.resume()
      }
    },

    cancel() {
      settle()
      // Suppress late `error` emitted between destroy() and the terminal `close`.
      const ignoreError = () => {}
      stream.on('error', ignoreError)
      stream.once('close', () => stream.off('error', ignoreError))
      stream.destroy()
    },
  })
}
