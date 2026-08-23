import type { Context, Env, MiddlewareHandler } from 'hono'
import { getMimeType } from 'hono/utils/mime'
import type { Stats } from 'node:fs'
import { createReadStream, statSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { createStreamBody } from './utils/stream'

export type ServeStaticOptions<E extends Env = Env> = {
  /**
   * Root path. Relative path is based on current working directory from which the app was started.
   */
  root?: string
  path?: string
  index?: string // default is 'index.html'
  precompressed?: boolean
  rewriteRequestPath?: (path: string, c: Context<E>) => string
  onFound?: (path: string, c: Context<E>) => void | Promise<void>
  onNotFound?: (path: string, c: Context<E>) => void | Promise<void>
}

export type SendFileOptions<E extends Env = Env> = Pick<
  ServeStaticOptions<E>,
  'root' | 'index' | 'precompressed' | 'onFound'
> & {
  /**
   * Called when the file is not found. Unlike the `onNotFound` option of `serveStatic`,
   * it can return a `Response`, which is then used as the response.
   * If it returns nothing, the Not Found Response of the Context (`c.notFound()`) is used.
   */
  onNotFound?: (path: string, c: Context<E>) => Response | void | Promise<Response | void>
}

const COMPRESSIBLE_CONTENT_TYPE_REGEX =
  /^\s*(?:text\/[^;\s]+|application\/(?:javascript|json|xml|xml-dtd|ecmascript|dart|postscript|rtf|tar|toml|vnd\.dart|vnd\.ms-fontobject|vnd\.ms-opentype|wasm|x-httpd-php|x-javascript|x-ns-proxy-autoconfig|x-sh|x-tar|x-virtualbox-hdd|x-virtualbox-ova|x-virtualbox-ovf|x-virtualbox-vbox|x-virtualbox-vdi|x-virtualbox-vhd|x-virtualbox-vmdk|x-www-form-urlencoded)|font\/(?:otf|ttf)|image\/(?:bmp|vnd\.adobe\.photoshop|vnd\.microsoft\.icon|vnd\.ms-dds|x-icon|x-ms-bmp)|message\/rfc822|model\/gltf-binary|x-shader\/x-fragment|x-shader\/x-vertex|[^;\s]+?\+(?:json|text|xml|yaml))(?:[;\s]|$)/i
const ENCODINGS = {
  br: '.br',
  zstd: '.zst',
  gzip: '.gz',
} as const
const ENCODINGS_ORDERED_KEYS = Object.keys(ENCODINGS) as (keyof typeof ENCODINGS)[]

const getStats = (path: string) => {
  let stats: Stats | undefined
  try {
    stats = statSync(path)
  } catch {}
  return stats
}

type ByteRangeSpec =
  | { type: 'bounded'; start: number; end: number }
  | { type: 'open-ended'; start: number }
  | { type: 'suffix'; length: number }

type ByteRange = { start: number; end: number }

const BYTE_RANGE_PATTERN = /^(?:bytes=)?(?!-$)(\d*)-(\d*)$/

const parseByteRange = (range: string): ByteRangeSpec | undefined => {
  const match = range.match(BYTE_RANGE_PATTERN)
  if (!match) {
    return undefined
  }

  const [, start, end] = match

  if (start === '') {
    return { type: 'suffix', length: Number(end) }
  }

  if (end === '') {
    return { type: 'open-ended', start: Number(start) }
  }

  return { type: 'bounded', start: Number(start), end: Number(end) }
}

const resolveByteRange = (spec: ByteRangeSpec, size: number): ByteRange | undefined => {
  if (size === 0) {
    return undefined
  }

  if (spec.type === 'suffix') {
    if (spec.length === 0) {
      return undefined
    }

    return { start: Math.max(size - spec.length, 0), end: size - 1 }
  }

  const end = spec.type === 'bounded' ? Math.min(spec.end, size - 1) : size - 1
  if (spec.start >= size || spec.start > end) {
    return undefined
  }

  return { start: spec.start, end }
}

type Decoder = (str: string) => string

const tryDecode = (str: string, decoder: Decoder): string => {
  try {
    return decoder(str)
  } catch {
    // Decode only valid %xx sequences in chunks; keep undecodable parts as-is
    return str.replace(/(?:%[0-9A-Fa-f]{2})+/g, (match) => {
      try {
        return decoder(match)
      } catch {
        return match
      }
    })
  }
}

const tryDecodeURI = (str: string) => tryDecode(str, decodeURI)

type FoundFile = { path: string; stats: Stats | undefined }

const findFile = (path: string, index?: string): FoundFile => {
  const stats = getStats(path)

  if (!stats?.isDirectory()) {
    return { path, stats }
  }

  const indexPath = join(path, index ?? 'index.html')
  return { path: indexPath, stats: getStats(indexPath) }
}

const findPrecompressedFile = (
  path: string,
  mimeType: string | undefined,
  acceptEncodingHeader: string | undefined
): { encoding: string; path: string; stats: Stats } | undefined => {
  const compressible =
    !mimeType ||
    mimeType === 'application/octet-stream' ||
    COMPRESSIBLE_CONTENT_TYPE_REGEX.test(mimeType)
  if (!compressible) {
    return undefined
  }

  const acceptedEncodings = new Set(
    acceptEncodingHeader?.split(',').map((encoding) => encoding.trim())
  )

  for (const encoding of ENCODINGS_ORDERED_KEYS) {
    if (!acceptedEncodings.has(encoding)) {
      continue
    }
    const precompressedPath = path + ENCODINGS[encoding]
    const stats = getStats(precompressedPath)
    if (stats) {
      return { encoding, path: precompressedPath, stats }
    }
  }
}

const createRangeResponse = <E extends Env>(
  c: Context<E>,
  path: string,
  range: string,
  size: number
): Response => {
  c.header('Accept-Ranges', 'bytes')

  // A malformed Range header serves the whole file, as `serveStatic` has always done.
  const rangeSpec: ByteRangeSpec = parseByteRange(range) ?? {
    type: 'open-ended',
    start: 0,
  }
  const resolvedRange = resolveByteRange(rangeSpec, size)

  if (!resolvedRange) {
    c.header('Content-Range', `bytes */${size}`)
    return c.body(null, 416)
  }

  const { start, end } = resolvedRange
  const chunkSize = end - start + 1
  c.header('Content-Length', chunkSize.toString())
  c.header('Content-Range', `bytes ${start}-${end}/${size}`)
  return c.body(createStreamBody(createReadStream(path, { start, end })), 206)
}

const createFileResponse = <E extends Env>(c: Context<E>, path: string, size: number): Response => {
  if (c.req.method === 'HEAD' || c.req.method === 'OPTIONS') {
    c.header('Content-Length', size.toString())
    c.status(200)
    return c.body(null)
  }

  const range = c.req.header('range')
  if (!range) {
    c.header('Content-Length', size.toString())
    return c.body(createStreamBody(createReadStream(path)), 200)
  }

  return createRangeResponse(c, path, range, size)
}

type ServeFileOptions<E extends Env> = Pick<ServeStaticOptions<E>, 'precompressed' | 'onFound'>

const serveFile = async <E extends Env>(
  c: Context<E>,
  path: string,
  stats: Stats,
  options: ServeFileOptions<E>
): Promise<Response> => {
  const mimeType = getMimeType(path)
  c.header('Content-Type', mimeType || 'application/octet-stream')

  if (options.precompressed) {
    const precompressed = findPrecompressedFile(path, mimeType, c.req.header('Accept-Encoding'))
    if (precompressed) {
      c.header('Content-Encoding', precompressed.encoding)
      c.header('Vary', 'Accept-Encoding', { append: true })
      path = precompressed.path
      stats = precompressed.stats
    }
  }

  c.header('Last-Modified', stats.mtime.toUTCString())
  const result = createFileResponse(c, path, stats.size)
  await options.onFound?.(path, c)
  return result
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const serveStatic = <E extends Env = any>(
  options: ServeStaticOptions<E> = { root: '' }
): MiddlewareHandler<E> => {
  const root = options.root || ''
  const optionPath = options.path

  if (root !== '' && !existsSync(root)) {
    console.error(`serveStatic: root path '${root}' is not found, are you sure it's correct?`)
  }

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
        filename = tryDecodeURI(c.req.path)
        if (/(?:^|[\/\\])\.{1,2}(?:$|[\/\\])|[\/\\]{2,}|\\/.test(filename)) {
          throw new Error()
        }
      } catch {
        await options.onNotFound?.(c.req.path, c)
        return next()
      }
    }

    const requestPath = join(
      root,
      !optionPath && options.rewriteRequestPath ? options.rewriteRequestPath(filename, c) : filename
    )

    const found = findFile(requestPath, options.index)

    if (!found.stats) {
      await options.onNotFound?.(found.path, c)
      return next()
    }

    return serveFile(c, found.path, found.stats, options)
  }
}

/**
 * Send a file as the response, like `res.sendFile()` of Express.
 *
 * While `serveStatic` serves files based on the request path, `sendFile` serves
 * the file at the given path, so it is useful when you want to determine the
 * file to serve dynamically. It sets the same headers (e.g. `Content-Type`,
 * `Content-Length`, `Last-Modified`) and supports the same features (range
 * requests, HEAD/OPTIONS requests, precompressed files) as `serveStatic`.
 *
 * When the file is not found, `sendFile` returns the Not Found Response of the
 * Context instead of calling the next handler. Customize this with the
 * `onNotFound` option, which may return a `Response` to use instead.
 *
 * @example
 * ```ts
 * app.get('/download/:id', (c) => sendFile(c, lookupFilePathById(c.req.param('id'))))
 * ```
 *
 * @see {@link https://github.com/honojs/node-server/issues/205}
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const sendFile = async <E extends Env = any>(
  c: Context<E>,
  path: string,
  options: SendFileOptions<E> = {}
): Promise<Response> => {
  if (c.finalized) {
    return c.res
  }

  const found = findFile(join(options.root || '', path), options.index)

  if (!found.stats) {
    const response = await options.onNotFound?.(found.path, c)
    return response ?? (await c.notFound())
  }

  return serveFile(c, found.path, found.stats, options)
}
