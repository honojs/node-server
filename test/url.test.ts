import { RequestError } from '../src/error'
import { buildUrl } from '../src/url'

describe('buildUrl', () => {
  describe('IPv6 host', () => {
    it('Should throw error for unmatched closing bracket in host', async () => {
      expect(() => {
        buildUrl('http', 'host]', '/foo.txt')
      }).toThrow('Invalid URL')
    })

    it('Should throw error for unmatched opening bracket in host', async () => {
      expect(() => {
        buildUrl('http', '[host', '/foo.txt')
      }).toThrow('Invalid URL')
    })
  })

  describe('URL normalization', () => {
    test.each([
      ['[::1]', '/foo.txt'],
      ['[::1]:8080', '/foo.txt'],
      ['localhost', '/'],
      ['localhost', '/foo/bar/baz'],
      ['localhost', '/foo_bar'],
      ['localhost', '/foo//bar'],
      ['localhost', '/static/%2e%2e/foo.txt'],
      ['localhost', '/static\\..\\foo.txt'],
      ['localhost', '/..'],
      ['localhost', '/foo/.'],
      ['localhost', '/foo/bar/..'],
      ['localhost', '/a/b/../../c'],
      ['localhost', '/a/../../../b'],
      ['localhost', '/a/b/c/../../../'],
      ['localhost', '/./foo.txt'],
      ['localhost', '/foo/../bar.txt'],
      ['localhost', '/a/./b/../c?q=%2E%2E#hash'],
      ['localhost', '/foo/%2E/bar/../baz'],
      ['localhost', '/hello%20world'],
      ['localhost', '/foo%23bar'],
      ['localhost', '/foo"bar'],
      ['localhost', '/%2e%2E/foo'],
      ['localhost', '/caf%C3%A9'],
      ['localhost', '/foo%2fbar/..//baz'],
      ['localhost', '/foo?q=../bar'],
      ['localhost', '/path?q=hello%20world'],
      ['localhost', '/file.txt'],
      ['localhost', ''],
      ['LOCALHOST', '/foo.txt'],
      ['LOCALHOST:80', '/foo.txt'],
      ['LOCALHOST:443', '/foo.txt'],
      ['LOCALHOST:8080', '/foo.txt'],
      ['Localhost:3000', '/foo.txt'],
    ])('Should normalize %s to %s', async (host, url) => {
      expect(buildUrl('http', host, url)).toBe(new URL(url, `http://${host}`).href)
    })

    it('Should throw a RequestError for non-origin-form request-target', async () => {
      expect(() => {
        buildUrl('http', 'localhost', '*')
      }).toThrow(RequestError)
    })

    it('Should throw a RequestError for invalid host header', async () => {
      expect(() => {
        buildUrl('http', 'localhost/foo', '/bar')
      }).toThrow(RequestError)
    })
  })
})
