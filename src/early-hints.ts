import type { Context, MiddlewareHandler } from 'hono'
import type { HttpBindings } from './types'

export type EarlyHintsOptions = {
  link: string | string[] | ((c: Context) => string | string[] | undefined)
}

/**
 * Early Hints middleware for Node.js
 * Automatically sends a 103 Early Hints informational response with the specified Link header(s).
 *
 * @param options EarlyHintsOptions
 * @returns MiddlewareHandler
 */
export const earlyHints = (options: EarlyHintsOptions): MiddlewareHandler => {
  let warned = false

  return async (c, next) => {
    const env = c.env || {}
    const bindings = (env.server ? env.server : env) as HttpBindings
    const outgoing = bindings?.outgoing

    // Capability check: outgoing.writeEarlyHints exists and is a function.
    // This guard exists for non-Node runtimes and non-HTTP bindings.
    if (typeof outgoing?.writeEarlyHints !== 'function') {
      if (!warned) {
        console.warn(
          'Early Hints Middleware is not supported because writeEarlyHints is not defined.'
        )
        warned = true
      }
      return await next()
    }

    if (!outgoing.headersSent) {
      const link = typeof options.link === 'function' ? options.link(c) : options.link

      if (link !== undefined && (Array.isArray(link) ? link.length > 0 : Boolean(link))) {
        outgoing.writeEarlyHints({ link })
      }
    }

    await next()
  }
}
