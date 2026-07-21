import type { Context, MiddlewareHandler } from 'hono'

export type EarlyHintHeaderValue = string | string[]
export type EarlyHints = Record<string, EarlyHintHeaderValue>

/**
 * Early Hints helper for Node.js
 * Sends a 103 Early Hints informational response to the client with the specified headers.
 * 
 * @param c Hono Context
 * @param hints Early Hints headers (typically Link headers)
 * @returns boolean indicating if the early hints were successfully written
 */
export const writeEarlyHints = (c: Context, hints: EarlyHints): boolean => {
  const env = c.env || {}
  const bindings = env.server ? env.server : env
  const outgoing = bindings.outgoing

  // Guard (a): c.env.outgoing exists and exposes writeEarlyHints as a function
  // Callers on other runtimes or older Node versions must not crash and will get false
  if (!outgoing || typeof outgoing.writeEarlyHints !== 'function') {
    return false
  }

  // Guard (b): headersSent is false (informational responses cannot be sent after headers are sent)
  if (outgoing.headersSent) {
    return false
  }

  // Guard (c): HTTP/2 binding support verified.
  // Both http.ServerResponse and http2.Http2ServerResponse support writeEarlyHints in Node.js >= 20.
  // Reference Node.js documentation:
  // - http: https://nodejs.org/api/http.html#responsewriteearlyhintshints
  // - http2: https://nodejs.org/api/http2.html#responsewriteearlyhintshints
  outgoing.writeEarlyHints(hints)
  return true
}

/**
 * Early Hints middleware for Node.js
 * Automatically sends a 103 Early Hints informational response with the specified headers.
 * 
 * @param hints Early Hints headers
 * @returns MiddlewareHandler
 */
export const earlyHints = (hints: EarlyHints): MiddlewareHandler => {
  return async (c, next) => {
    writeEarlyHints(c, hints)
    await next()
  }
}
