import type { GetConnInfo } from 'hono/conninfo'
import type { HttpBindings } from './types'

/**
 * ConnInfo Helper for Node.js
 * @param c Context
 * @returns ConnInfo
 */
export const getConnInfo: GetConnInfo = (c) => {
  const bindings = (c.env.server ? c.env.server : c.env) as HttpBindings

  const address = bindings.incoming.socket.remoteAddress
  const port = bindings.incoming.socket.remotePort
  const family = bindings.incoming.socket.remoteFamily

  return {
    remote: {
      address,
      port,
      addressType: family === 'IPv4' ? 'IPv4' : family === 'IPv6' ? 'IPv6' : void 0,
    },
  }
}
