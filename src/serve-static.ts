import type { Handler } from 'hono'
import { createReadStream, existsSync, lstatSync } from 'fs'
import { getFilePath } from 'hono/utils/filepath'
import { getMimeType } from 'hono/utils/mime'

export type ServeStaticOptions = {
  root?: string
  path?: string
  index?: string // default is 'index.html'
}

export const serveStatic = (options: ServeStaticOptions = { root: '' }): Handler => {
  return async (c, next) => {
    // Do nothing if Response is already set
    if (c.finalized) return next()

    const url = new URL(c.req.url)

    let path = getFilePath({
      filename: options.path ?? decodeURIComponent(url.pathname),
      root: options.root,
      defaultDocument: options.index ?? 'index.html',
    })

    path = `./${path}`

    if (existsSync(path)) {
      const mimeType = getMimeType(path)

      const stat = lstatSync(path)

      if (mimeType) {
        c.header('Content-Type', mimeType)
      }

      c.header('Accept-Ranges', 'bytes')

      c.header('Date', stat.birthtime.toUTCString())

      if (c.req.method == 'HEAD' || c.req.method == 'OPTIONS') {
        c.header('Content-Length', stat.size.toString())

        c.status(200)

        return c.body(null)
      }

      const range = c.req.headers.get('range')

      let start = 0
      let end = stat.size - 1

      if (range) {
        const parts = range.replace(/bytes=/, '').split('-')
        start = parseInt(parts[0], 10)
        end = parts[1] ? parseInt(parts[1], 10) : end
      }

      const chunksize = end - start + 1

      const stream = createReadStream(path, { start, end })

      c.header('Content-Length', chunksize.toString())

      c.header('Content-Range', `bytes ${start}-${end}/${stat.size}`)

      c.status(range ? 206 : 200)

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

      return c.body(body)
    }

    return next()
  }
}
