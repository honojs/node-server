import type { Context, Env, MiddlewareHandler } from 'hono'
import { getMimeType } from 'hono/utils/mime'
import type { ReadStream, Stats } from 'node:fs'
import { createReadStream, lstatSync } from 'node:fs'
import { join } from 'node:path'

export type ServeStaticOptions<E extends Env = Env> = {
  /**
   * Root path, relative to current working directory from which the app was started. Absolute paths are not supported.
   */
  root?: string
  path?: string
  index?: string // default is 'index.html'
  precompressed?: boolean
  rewriteRequestPath?: (path: string, c: Context<E>) => string
  onFound?: (path: string, c: Context<E>) => void | Promise<void>
  onNotFound?: (path: string, c: Context<E>) => void | Promise<void>
}

const COMPRESSIBLE_CONTENT_TYPE_REGEX =
  /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i
const ENCODINGS = {
  br: '.br',
  zstd: '.zst',
  gzip: '.gz',
} as const
const ENCODINGS_ORDERED_KEYS = Object.keys(ENCODINGS) as (keyof typeof ENCODINGS)[]

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

const getStats = (path: string) => {
  let stats: Stats | undefined
  try {
    stats = lstatSync(path)
  } catch {}
  return stats
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const serveStatic = <E extends Env = any>(
  options: ServeStaticOptions<E> = { root: '' }
): MiddlewareHandler<E> => {
  const root = options.root || ''
  const optionPath = options.path

  return async (c, next) => {
    // Do nothing if Response is already set
    if (c.finalized) {
      return next()
    }

    let filename: string

    if (optionPath) {
      filename = optionPath
    } else {
      try {
        filename = decodeURIComponent(c.req.path)
        if (/(?:^|[\/\\])\.\.(?:$|[\/\\])/.test(filename)) {
          throw new Error()
        }
      } catch {
        await options.onNotFound?.(c.req.path, c)
        return next()
      }
    }

    let path = join(
      root,
      !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename, c) : filename
    )

    let stats = getStats(path)

    if (stats && stats.isDirectory()) {
      const indexFile = options.index ?? 'index.html'
      path = join(path, indexFile)
      stats = getStats(path)
    }

    if (!stats) {
      await options.onNotFound?.(path, c)
      return next()
    }
    await options.onFound?.(path, c)

    const mimeType = getMimeType(path)
    c.header('Content-Type', mimeType || 'application/octet-stream')

    if (options.precompressed && (!mimeType || COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType))) {
      const acceptEncodingSet = new Set(
        c.req
          .header('Accept-Encoding')
          ?.split(',')
          .map((encoding) => encoding.trim())
      )

      for (const encoding of ENCODINGS_ORDERED_KEYS) {
        if (!acceptEncodingSet.has(encoding)) {
          continue
        }
        const precompressedStats = getStats(path + ENCODINGS[encoding])
        if (precompressedStats) {
          c.header('Content-Encoding', encoding)
          c.header('Vary', 'Accept-Encoding', { append: true })
          stats = precompressedStats
          path = path + ENCODINGS[encoding]
          break
        }
      }
    }

    const size = stats.size

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
    c.header('Date', stats.birthtime.toUTCString())

    const parts = range.replace(/bytes=/, '').split('-', 2)
    const start = parts[0] ? parseInt(parts[0], 10) : 0
    let end = parts[1] ? parseInt(parts[1], 10) : stats.size - 1
    if (size < end - start + 1) {
      end = size - 1
    }

    const chunksize = end - start + 1
    const stream = createReadStream(path, { start, end })

    c.header('Content-Length', chunksize.toString())
    c.header('Content-Range', `bytes ${start}-${end}/${stats.size}`)

    return c.body(createStreamBody(stream), 206)
  }
}
