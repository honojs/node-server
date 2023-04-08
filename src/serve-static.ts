import type { Next } from 'hono'
import { Context } from 'hono'
import { existsSync, readFileSync } from 'fs'
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

export const serveStatic = (options: ServeStaticOptions = { root: '' }) => {
  return async (c: Context, next: Next): Promise<Response | undefined> => {
    // Do nothing if Response is already set
    if (c.finalized) {
      await next()
    }
    const url = new URL(c.req.url)

    const filename = options.path ?? url.pathname
    let path = getFilePath({
      filename: options.rewriteRequestPath ? options.rewriteRequestPath(filename) : filename,
      root: options.root,
      defaultDocument: options.index ?? 'index.html',
    })
    path = `./${path}`

    if (existsSync(path)) {
      const content = readFileSync(path)
      if (content) {
        const mimeType = getMimeType(path)
        if (mimeType) {
          c.header('Content-Type', mimeType)
        }
        // Return Response object
        return c.body(content)
      }
    }

    console.warn(`Static file: ${path} is not found`)
    await next()
    return
  }
}
