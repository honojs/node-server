import type { Context, Env, Next } from 'hono'
import type { StatusCode } from 'hono/utils/http-status'
import { getMimeType } from 'hono/utils/mime'
import { createReadStream } from 'fs'
import { createStreamBody, getStats } from './serve-static'

export const sendFile = async <E extends Env = Env>(
    c: Context<E, string, {}>,
    next: Next,
    path: string,
    options: {
        onNotFound?: (path: string, c: Context<E>) => void | Promise<void>;
        emptyBody?: {
            [method: string]: StatusCode;
        };
    } = {
            emptyBody: {
                HEAD: 204,
                OPTIONS: 204,
            },
        }
) => {
    const stats = getStats(path)

    if (!stats) {
        await options.onNotFound?.(path, c)
        return next()
    }

    const mimeType: string = getMimeType(path) || 'application/octet-stream'
    c.header('Content-Type', mimeType)

    const size = stats.size

    const { emptyBody } = options
    if (emptyBody) {
        for (const [k, v] of Object.entries(emptyBody)) {
            if (k === c.req.method) {
                c.header('Content-Length', size.toString())
                return c.body(null, v)
            }
        }
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
