import type { Context, Env, MiddlewareHandler } from 'hono'
import type { HttpBindings } from './types'

export type EarlyHintsOptions<E extends Env = Env> = {
  link: string | string[] | ((c: Context<E>) => string | string[] | undefined)
}

/**
 * Early Hints middleware for Node.js
 * Automatically sends a 103 Early Hints informational response with the specified Link header(s).
 *
 * @param options EarlyHintsOptions
 * @returns MiddlewareHandler
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const earlyHints = <E extends Env = any>(
  options: EarlyHintsOptions<E>
): MiddlewareHandler<E> => {
  let warned = false

  return async (c, next) => {
    const mode = c.req.header('Sec-Fetch-Mode')
    const dest = c.req.header('Sec-Fetch-Dest')

    if ((mode && mode !== 'navigate') || (dest && dest !== 'document')) {
      return next()
    }

    const env = c.env || {}
    const bindings = ('server' in env ? env.server : env) as HttpBindings
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
