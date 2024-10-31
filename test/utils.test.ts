import { buildOutgoingHttpHeaders } from '../src/utils'

describe('buildOutgoingHttpHeaders', () => {
  it('original content-type is preserved', () => {
    const headers = new Headers({
      a: 'b',
      'content-type': 'text/html; charset=UTF-8',
    })
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/html; charset=UTF-8',
    })
  })

  it('multiple set-cookie', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'a')
    headers.append('set-cookie', 'b')
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      'set-cookie': ['a', 'b'],
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Headers', () => {
    const headers = new Headers({
      a: 'b',
    })
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Record<string, string>', () => {
    const headers = {
      a: 'b',
      'Set-Cookie': 'c', // case-insensitive
    }
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'set-cookie': ['c'],
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Record<string, string>[]', () => {
    const headers: HeadersInit = [['a', 'b']]
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('null', () => {
    const result = buildOutgoingHttpHeaders(null)
    expect(result).toEqual({
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('undefined', () => {
    const result = buildOutgoingHttpHeaders(undefined)
    expect(result).toEqual({
      'content-type': 'text/plain; charset=UTF-8',
    })
  })
})
