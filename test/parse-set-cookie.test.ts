import assert from 'assert'
import { parseSetCookie } from "../src/parse-set-cookie"

const splitCookiesString = parseSetCookie

const cookieNoParams = "sessionid=6ky4pkr7qoi4me7rwleyvxjove25huef"
const cookieWithParams = `${cookieNoParams}; HttpOnly; Path=/`
const cookieWithExpires =
  "cid=70125eaa-399a-41b2-b235-8a5092042dba; expires=Thu, 04-Jun-2020 12:17:56 GMT; Max-Age=63072000; Path=/; HttpOnly; Secure"
const cookieWithExpiresAtEnd =
  "client_id=70125eaa-399a-41b2-b235-8a5092042dba; Max-Age=63072000; Path=/; expires=Thu, 04-Jun-2020 12:17:56 GMT"
const jsonCookie = `myJsonCookie=${JSON.stringify({
  foo: "bar",
  arr: [1, 2, 3],
})}`
const jsonCookieWithParams = `${jsonCookie}; expires=Thu, 04-Jun-2020 12:17:56 GMT; Max-Age=63072000; Path=/; HttpOnly; Secure`

const firstWithParamSecondNoParam = `${cookieWithParams}, ${cookieNoParams}`
const threeNoParams = `${cookieNoParams}, ${cookieNoParams}, ${cookieNoParams}`
const threeWithParams = `${cookieWithParams}, ${cookieWithParams}, ${cookieWithParams}`
const firstWithExpiresSecondNoParam = `${cookieWithExpires}, ${cookieNoParams}`
const firstWithExpiresSecondWithParam = `${cookieWithExpires}, ${cookieWithParams}`
const firstWithExpiresAtEndSecondNoParam = `${cookieWithExpiresAtEnd}, ${cookieNoParams}`
const firstWithExpiresAtEndSecondWithParam = `${cookieWithExpiresAtEnd}, ${cookieWithParams}`
const firstWithExpiresSecondWithExpires = `${cookieWithExpires}, ${cookieWithExpires}`
const firstWithExpiresSecondWithExpiresAtEnd = `${cookieWithExpires}, ${cookieWithExpiresAtEnd}`
const firstWithExpiresAtEndSecondWithExpires = `${cookieWithExpiresAtEnd}, ${cookieWithExpires}`
const firstWithExpiresAtEndSecondWithExpiresAtEnd = `${cookieWithExpiresAtEnd}, ${cookieWithExpiresAtEnd}`
const firstWithExpiresSecondWithExpiresAtEndThirdWithExpires = `${cookieWithExpires}, ${cookieWithExpiresAtEnd}, ${cookieWithExpires}`
const firstWithExpiresSecondWithExpiresAtEndThirdWithExpiresAtEnd = `${cookieWithExpires}, ${cookieWithExpiresAtEnd}, ${cookieWithExpiresAtEnd}`
const threeWithExpires = `${cookieWithExpires}, ${cookieWithExpires}, ${cookieWithExpires}`
const threeWithExpiresAtEnd = `${cookieWithExpiresAtEnd}, ${cookieWithExpiresAtEnd}, ${cookieWithExpiresAtEnd}`

/**
 * Test cases from `set-cookie-parser`
 * @see https://github.com/nfriedly/set-cookie-parser/blob/master/test/split-cookies-string.js
 */
describe("splitCookiesString", function () {
  it("should parse empty string", function () {
    var actual = splitCookiesString("")
    var expected = [] as string[]
    assert.deepEqual(actual, expected)
  })

  it("should parse single cookie without params", function () {
    var actual = splitCookiesString(cookieNoParams)
    var expected = [cookieNoParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse single cookie with params", function () {
    var actual = splitCookiesString(cookieWithParams)
    var expected = [cookieWithParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse three cookies without params", function () {
    var actual = splitCookiesString(threeNoParams)
    var expected = [cookieNoParams, cookieNoParams, cookieNoParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse Three with params", function () {
    var actual = splitCookiesString(threeWithParams)
    var expected = [cookieWithParams, cookieWithParams, cookieWithParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with params, second without params", function () {
    var actual = splitCookiesString(firstWithParamSecondNoParam)
    var expected = [cookieWithParams, cookieNoParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse single with expires", function () {
    var actual = splitCookiesString(cookieWithExpires)
    var expected = [cookieWithExpires]
    assert.deepEqual(actual, expected)
  })

  it("should parse single with expires at end", function () {
    var actual = splitCookiesString(cookieWithExpiresAtEnd)
    var expected = [cookieWithExpiresAtEnd]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires, second without params", function () {
    var actual = splitCookiesString(firstWithExpiresSecondNoParam)
    var expected = [cookieWithExpires, cookieNoParams]
    assert.deepEqual(actual, expected)
  });

  it("should parse first with expires, second with params", function () {
    var actual = splitCookiesString(firstWithExpiresSecondWithParam)
    var expected = [cookieWithExpires, cookieWithParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires at end, second without params", function () {
    var actual = splitCookiesString(firstWithExpiresAtEndSecondNoParam)
    var expected = [cookieWithExpiresAtEnd, cookieNoParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires at end, second with params", function () {
    var actual = splitCookiesString(firstWithExpiresAtEndSecondWithParam)
    var expected = [cookieWithExpiresAtEnd, cookieWithParams]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires, second with expires", function () {
    var actual = splitCookiesString(firstWithExpiresSecondWithExpires)
    var expected = [cookieWithExpires, cookieWithExpires]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires, second with expires at end", function () {
    var actual = splitCookiesString(firstWithExpiresSecondWithExpiresAtEnd)
    var expected = [cookieWithExpires, cookieWithExpiresAtEnd]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires at end, second with expires", function () {
    var actual = splitCookiesString(firstWithExpiresAtEndSecondWithExpires)
    var expected = [cookieWithExpiresAtEnd, cookieWithExpires]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires at end, second with expires at end", function () {
    var actual = splitCookiesString(
      firstWithExpiresAtEndSecondWithExpiresAtEnd
    )
    var expected = [cookieWithExpiresAtEnd, cookieWithExpiresAtEnd]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires, second with expires at end, third with expires", function () {
    var actual = splitCookiesString(
      firstWithExpiresSecondWithExpiresAtEndThirdWithExpires
    )
    var expected = [
      cookieWithExpires,
      cookieWithExpiresAtEnd,
      cookieWithExpires,
    ]
    assert.deepEqual(actual, expected)
  })

  it("should parse first with expires, second with expires at end, third with expires at end", function () {
    var actual = splitCookiesString(
      firstWithExpiresSecondWithExpiresAtEndThirdWithExpiresAtEnd
    )
    var expected = [
      cookieWithExpires,
      cookieWithExpiresAtEnd,
      cookieWithExpiresAtEnd,
    ]
    assert.deepEqual(actual, expected)
  })

  it("should parse three with expires", function () {
    var actual = splitCookiesString(threeWithExpires)
    var expected = [cookieWithExpires, cookieWithExpires, cookieWithExpires]
    assert.deepEqual(actual, expected)
  })

  it("should parse three with expires at end", function () {
    var actual = splitCookiesString(threeWithExpiresAtEnd)
    var expected = [
      cookieWithExpiresAtEnd,
      cookieWithExpiresAtEnd,
      cookieWithExpiresAtEnd,
    ]
    assert.deepEqual(actual, expected)
  })

  it("should not split json", function () {
    var actual = splitCookiesString(jsonCookie)
    var expected = [jsonCookie]
    assert.deepEqual(actual, expected)
  })

  it("should not split json with params", function () {
    var actual = splitCookiesString(jsonCookieWithParams)
    var expected = [jsonCookieWithParams]
    assert.deepEqual(actual, expected)
  })
})
