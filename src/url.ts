import { RequestError } from './error'

// Fast-path character validation for request URLs.
// Matches: ! # $ & ' ( ) * + , - . / 0-9 : ; = ? @ A-Z [ ] _ a-z ~
// Rejects: control chars, space, " % < > \ ^ ` { | } DEL, non-ASCII → fallback to new URL()
const reValidRequestUrl = /^\/[!#$&-;=?-\[\]_a-z~]*$/

// Dot segments: /. or /.. followed by / ? # or end-of-string
const reDotSegment = /\/\.\.?(?:[/?#]|$)/

// Host validation: a-z 0-9 . - _ with optional port 1000-59999
const reValidHost = /^[a-z0-9._-]+(?::(?:[1-5]\d{3,4}|[6-9]\d{3}))?$/

export const buildUrl = (scheme: string, host: string, incomingUrl: string) => {
  const url = `${scheme}://${host}${incomingUrl}`

  if (!reValidHost.test(host)) {
    const urlObj = new URL(url)

    // if suspicious, check by host. host header sometimes contains port.
    if (
      urlObj.hostname.length !== host.length &&
      urlObj.hostname !== (host.includes(':') ? host.replace(/:\d+$/, '') : host).toLowerCase()
    ) {
      throw new RequestError('Invalid host header')
    }
    return urlObj.href
  } else if (incomingUrl.length === 0) {
    return url + '/'
  } else {
    if (incomingUrl.charCodeAt(0) !== 0x2f) {
      // '/'
      throw new RequestError('Invalid URL')
    }

    if (!reValidRequestUrl.test(incomingUrl) || reDotSegment.test(incomingUrl)) {
      return new URL(url).href
    }

    return url
  }
}
