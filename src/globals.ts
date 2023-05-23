import crypto from 'node:crypto'
import { parseSetCookie } from './parse-set-cookie'
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

/** 
 * In node 18.0.0 release, `Headers.prototype` dose not have getSetCookie method
 */
if (typeof (global.Headers.prototype as any).getSetCookie !== 'function') {
  ;(global.Headers.prototype as any).getSetCookie = function getSetCookie(this: Headers) {
    const cookies = this.get('set-cookie')
    if (!cookies) return []
    return parseSetCookie(cookies)
  }
}

/**
 * In node 18.0.0 release, `FormData.prototype` dose not have forEach method, which
 * will lead hono to throw an errors
 */
if (typeof global.FormData.prototype.forEach !== 'function') {
  global.FormData.prototype.forEach = function forEach(
    this: FormData,
    callbackFn: (value: FormDataEntryValue, key: string, parent: FormData) => void,
    thisArg?: any
  ) {
    if (typeof callbackFn !== 'function') {
      throw new TypeError(
        "Failed to execute 'forEach' on 'FormData': parameter 1 is not of type 'Function'."
      )
    }
  
    for (const [key, value] of this) {
      callbackFn.apply(thisArg, [value, key, this])
    }
  }
}