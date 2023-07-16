import type { MiddlewareHandler } from 'hono'
import { ReadStream, createReadStream, existsSync, lstatSync } from 'fs'
import { getFilePath } from 'hono/utils/filepath'
import { getMimeType } from 'hono/utils/mime'

export type ServeStaticOptions = {
  /**
   * Root path, relative to current working directory. (absolute paths are not supported)
   */
  root?: string
  path?: string
  index?: string // default is 'index.html'
  rewriteRequestPath?: (path: string) => string
}

const createStreamBody = (stream: ReadStream) => {
  const body = new ReadableStream({
    start(controller) {
      stream.on('data', (chunk) => {
        controller.enqueue(chunk)
      })
      stream.on('end', () => {
        controller.close()
      })
    },

    cancel() {
      stream.destroy()
    },
  })
  return body
}

export const serveStatic = (options: ServeStaticOptions = { root: '' }): MiddlewareHandler => {
  return async (c, next) => {
    // Do nothing if Response is already set
    if (c.finalized) return next()

    const url = new URL(c.req.url)

    const filename = options.path ?? decodeURIComponent(url.pathname)
    let path = getFilePath({
      filename: options.rewriteRequestPath ? options.rewriteRequestPath(filename) : filename,
      root: options.root,
      defaultDocument: options.index ?? 'index.html',
    })

    path = `./${path}`

    if (!existsSync(path)) {
      return next()
    }

    const mimeType = getMimeType(path)
    if (mimeType) {
      c.header('Content-Type', mimeType)
    }

    const stat = lstatSync(path)
    const size = stat.size

    if (c.req.method == 'HEAD' || c.req.method == 'OPTIONS') {
      c.header('Content-Length', size.toString())
      c.status(200)
      return c.body(null)
    }

    const range = c.req.header('range') || ''

    if (!range) {
      c.header('Content-Length', size.toString())
      return c.body(createStreamBody(createReadStream(path)), 200)
    }

    c.header('Accept-Ranges', 'bytes')
    c.header('Date', stat.birthtime.toUTCString())

    let start = 0
    let end = stat.size - 1

    const parts = range.replace(/bytes=/, '').split('-')
    start = parseInt(parts[0], 10)
    end = parts[1] ? parseInt(parts[1], 10) : end
    if (size < end - start + 1) {
      end = size - 1
    }

    const chunksize = end - start + 1
    const stream = createReadStream(path, { start, end })

    c.header('Content-Length', chunksize.toString())
    c.header('Content-Range', `bytes ${start}-${end}/${stat.size}`)

    return c.body(createStreamBody(stream), 206)
  }
}
