import crypto from 'node:crypto'
import { Response } from './response'

Object.defineProperty(global, 'Response', {
  value: Response,
})

const webFetch = global.fetch

/** jest dose not use crypto in the global, but this is OK for node 18 */
if (typeof global.crypto === 'undefined') {
  global.crypto = crypto as Crypto
}

global.fetch = (info, init?) => {
  init = {
    // Disable compression handling so people can return the result of a fetch
    // directly in the loader without messing with the Content-Encoding header.
    compress: false,
    ...init,
  } as RequestInit

  return webFetch(info, init)
}