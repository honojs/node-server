import { Writable, Readable, pipeline, finished } from 'node:stream'
import { promisify } from 'node:util'

const pipelinePromise = promisify(pipeline)

/** pipeline will assure the backpressure and reduce huge memory usage */
export async function writeReadableStreamToWritable(
  stream: ReadableStream,
  writable: Writable
) {
  const readable = webReadableStreamToNodeReadable(stream)
  return pipelinePromise(readable, writable)
}

/** This implementation use nodejs Readable::fromWeb as references */
export function webReadableStreamToNodeReadable(
  stream: ReadableStream
): Readable {
  const reader = stream.getReader()
  let closed = false

  const readable = new Readable({
    read() {
      reader
        .read()
        .then(({ done, value }) => {
          if (done) {
            this.push(null)
          } else {
            this.push(value)
          }
        })
        .catch(e => {
          readable.destroy(e)
        })
    },
    destroy(error, callback) {
      const done = () => {
        try {
          callback(error)
        } catch (err: unknown) {
          process.nextTick(() => {
            throw err
          })
        }
      }

      if (!closed) {
        reader.cancel(error).then(done, done)
        return
      }
      done()
    },
  })

  reader.closed.then(
    () => {
      closed = true
    },
    error => {
      readable.destroy(error)
    }
  )

  return readable
}

export function nodeReadableToWebReadableStream(readable: Readable) {
  if (readable.destroyed) {
    const stream = new ReadableStream<Uint8Array>()
    stream.cancel()
    return stream
  }

  const highWaterMark = readable.readableHighWaterMark
  const strategy = { highWaterMark }

  let controller: ReadableStreamDefaultController<Uint8Array>

  const onData = (chunk: Buffer | Uint8Array) => {
    // Copy the Buffer to detach it from the pool.
    if (Buffer.isBuffer(chunk)) {
      chunk = new Uint8Array(chunk)
    }
    controller.enqueue(chunk)
    if (controller.desiredSize && controller.desiredSize <= 0) {
      readable.pause()
    }
  }

  readable.pause()

  const cleanup = finished(readable, error => {
    if (error?.code === 'ERR_STREAM_PREMATURE_CLOSE') {
      const err = new Error(undefined, { cause: error })
      Object.defineProperty(err, 'name', 'AbortError')
      error = err
    }

    cleanup()

    // This is a protection against non-standard, legacy streams
    // that happen to emit an error event again after finished is called.
    readable.on('error', () => {})
    if (error) {
      return controller.error(error)
    }

    controller.close()
  })

  readable.on('data', onData)

  return new ReadableStream<Uint8Array>(
    {
      start(c) {
        controller = c
      },
      pull() {
        readable.resume()
      },
      cancel(reason) {
        readable.destroy(reason)
      },
    },
    strategy
  )
}
