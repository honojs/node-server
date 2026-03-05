const isPathDelimiter = (charCode: number): boolean =>
  charCode === 0x2f || charCode === 0x3f || charCode === 0x23

// `/.`, `/..` (including `%2e` variants, which are handled by `%` detection) are normalized by `new URL()`.
const hasDotSegment = (url: string, dotIndex: number): boolean => {
  const prev = dotIndex === 0 ? 0x2f : url.charCodeAt(dotIndex - 1)
  if (prev !== 0x2f) {
    return false
  }

  const nextIndex = dotIndex + 1
  if (nextIndex === url.length) {
    return true
  }

  const next = url.charCodeAt(nextIndex)
  if (isPathDelimiter(next)) {
    return true
  }
  if (next !== 0x2e) {
    return false
  }

  const nextNextIndex = dotIndex + 2
  if (nextNextIndex === url.length) {
    return true
  }
  return isPathDelimiter(url.charCodeAt(nextNextIndex))
}

const allowedRequestUrlChar = new Uint8Array(128)
for (let c = 0x30; c <= 0x39; c++) {
  allowedRequestUrlChar[c] = 1
}
for (let c = 0x41; c <= 0x5a; c++) {
  allowedRequestUrlChar[c] = 1
}
for (let c = 0x61; c <= 0x7a; c++) {
  allowedRequestUrlChar[c] = 1
}
;(() => {
  const chars = '-./:?#[]@!$&\'()*+,;=~_'
  for (let i = 0; i < chars.length; i++) {
    allowedRequestUrlChar[chars.charCodeAt(i)] = 1
  }
})()

const safeHostChar = new Uint8Array(128)
// 0-9
for (let c = 0x30; c <= 0x39; c++) {
  safeHostChar[c] = 1
}
// a-z
for (let c = 0x61; c <= 0x7a; c++) {
  safeHostChar[c] = 1
}
;(() => {
  const chars = '.-_'
  for (let i = 0; i < chars.length; i++) {
    safeHostChar[chars.charCodeAt(i)] = 1
  }
})()

export const buildUrl = (scheme: string, host: string, incomingUrl: string) => {
  const url = `${scheme}://${host}${incomingUrl}`

  let needsHostValidationByURL = false
  for (let i = 0, len = host.length; i < len; i++) {
    const c = host.charCodeAt(i)
    if (c > 0x7f || safeHostChar[c] === 0) {
      needsHostValidationByURL = true
      break
    }
  }

  if (needsHostValidationByURL) {
    const urlObj = new URL(url)

    // if suspicious, check by host. host header sometimes contains port.
    if (
      urlObj.hostname.length !== host.length &&
      urlObj.hostname !== (host.includes(':') ? host.replace(/:\d+$/, '') : host).toLowerCase()
    ) {
      throw 'Invalid host header'
    }
    return urlObj.href
  } else if (incomingUrl.length === 0) {
    return url + '/'
  } else {
    if (incomingUrl.charCodeAt(0) !== 0x2f) {
      // '/'
      throw 'Invalid URL'
    }

    for (let i = 1, len = incomingUrl.length; i < len; i++) {
      const c = incomingUrl.charCodeAt(i)
      if (
        c > 0x7f ||
        allowedRequestUrlChar[c] === 0 ||
        (c === 0x2e && hasDotSegment(incomingUrl, i))
      ) {
        return new URL(url).href
      }
    }

    return url
  }
}
