const { parseSetCookie } = require('../../dist/parse-set-cookie.js')
const { splitCookiesString } = require('./split-cookie.js')

function main() {
  const setCookieArr = [
    'id=a3fWa; Expires=Wed, 21 Oct 2015 07:28:00 GMT',
    'Set-Cookie: qwerty=219ffwef9w0f; Domain=somecompany.co.uk',
    '__Host-id=1; Secure; Path=/; Domain=example.com',
    '__Host-example=34d8g; SameSite=None; Secure; Path=/; Partitioned;'
  ]

  const setCookieFromHeaders = setCookieArr.join(', ')

  console.time('parseSetCookie')
  for (let i = 0; i < 100000; i++) {
    splitCookiesString(setCookieFromHeaders)
  }
  console.timeEnd('parseSetCookie')

  console.time('parseSetCookie')
  for (let i = 0; i < 100000; i++) {
    parseSetCookie(setCookieFromHeaders)
  }
  console.timeEnd('parseSetCookie')

}

main()