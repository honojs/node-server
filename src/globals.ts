import crypto from 'node:crypto'

/** jest dose not use crypto in the global, but this is OK for node 18 */
if (typeof global.crypto === 'undefined') {
  global.crypto = crypto as Crypto
}
