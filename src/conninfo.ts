import type { GetConnInfo } from 'hono/conninfo'
import type { AddressInfo } from 'net'
import type { HttpBindings } from './types'

/**
 * ConnInfo Helper for Node.js
 * @param c Context
 * @returns ConnInfo
 */
export const getConnInfo: GetConnInfo = (c) => {
  const bindings = (c.env.server ? c.env.server : c.env) as HttpBindings

  const address = bindings.incoming.socket.address() as AddressInfo

  if (!('address' in address)) {
    return {
      remote: {},
    }
  }

  return {
    remote: {
      address: address.address,
      addressType:
        address.family === 'IPv4' ? 'IPv4' : address.family === 'IPv6' ? 'IPv6' : 'unknown',
      port: address.port,
    },
  }
}
