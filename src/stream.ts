import { Writable, Readable } from 'node:stream'
import { pipeline } from 'node:stream'
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
