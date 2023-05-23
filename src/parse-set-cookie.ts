/**
 * A function to parse comma joint set-cookie headers from Headers.get('set-cookie')
 * with arbitrary whitespace and line breaks.
 * This parser will be 7x faster than `set-cookie-parser`
 * @see https://github.com/nfriedly/set-cookie-parser/blob/876f9ed639ce676342788d1f984013ee6db62284/lib/set-cookie.js#LL150C1-L221C2
 * And can pass all the tests from `set-cookie-parser`
 */
const SET_COOKIE_REGEXP = /([^ ;,"()[?={}@:\\\/<>\]]+=(?:[^=;]*(?=;|$|,\s*[^=,;]+=)(?:;|\s*expires=(?:.*?)GMT|\s*[^ ;,"()[?={}@:\\\/<>\]]+(?:=[^,;]*)?)*|$))(?:,\s*|$)/i

export function parseSetCookie(setCookie: string) {
  const cookies = [] as string[]
  let m = setCookie.match(SET_COOKIE_REGEXP)
  while (m) {
    cookies.push(m[1])
    const index = m.index || 0
    setCookie = setCookie.substring(index + m[0].length)
    m = setCookie.match(SET_COOKIE_REGEXP)
  }
  return cookies
}