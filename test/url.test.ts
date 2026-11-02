import { RequestError } from '../src/error'
import { buildUrl } from '../src/url'

describe('buildUrl', () => {
  it.each(['/', '/api/users?page=2&limit=20'])(
    'should build a fast-path URL without invoking the URL parser: %s',
    (path) => {
      const urlConstructor = vi.spyOn(globalThis, 'URL')
      try {
        expect(buildUrl('http', 'localhost:3000', path)).toBe(`http://localhost:3000${path}`)
        expect(urlConstructor).not.toHaveBeenCalled()
      } finally {
        urlConstructor.mockRestore()
      }
    }
  )

  describe.each(['localhost:3000', 'LOCALHOST', 'localhost:80', '[::1]:3000'])(
    'request path validation with host %s',
    (host) => {
      it.each([
        '/admin\\secret',
        '/public\\..\\admin/secret',
        '/public\\%2e%2e\\admin/secret',
        '/admin\\secret?next=public',
        '/public%3Fq=\\..\\admin/secret',
      ])('should reject a raw backslash in the path: %s', (path) => {
        expect(() => buildUrl('http', host, path)).toThrow(RequestError)
      })

      it.each([
        '/admin%5Csecret',
        '/public%5c..%5cadmin/secret',
        '/public?q=\\admin\\secret',
        '/public?q=one?two\\three',
      ])('should preserve encoded backslashes and query backslashes: %s', (path) => {
        expect(buildUrl('http', host, path)).toBe(new URL(path, `http://${host}`).href)
      })
    }
  )

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
      ['https', '[::1]', '/foo.txt'],
      ['https', '[::1]:8080', '/foo.txt'],
      ['https', 'localhost', '/'],
      ['https', 'localhost', '/foo/bar/baz'],
      ['https', 'localhost', '/foo_bar'],
      ['https', 'localhost', '/foo//bar'],
      ['https', 'localhost', '/static/%2e%2e/foo.txt'],
      ['https', 'localhost', '/..'],
      ['https', 'localhost', '/foo/.'],
      ['https', 'localhost', '/foo/bar/..'],
      ['https', 'localhost', '/a/b/../../c'],
      ['https', 'localhost', '/a/../../../b'],
      ['https', 'localhost', '/a/b/c/../../../'],
      ['https', 'localhost', '/./foo.txt'],
      ['https', 'localhost', '/foo/../bar.txt'],
      ['https', 'localhost', '/a/./b/../c?q=%2E%2E#hash'],
      ['https', 'localhost', '/foo/%2E/bar/../baz'],
      ['https', 'localhost', '/hello%20world'],
      ['https', 'localhost', '/foo%23bar'],
      ['https', 'localhost', '/foo"bar'],
      ['https', 'localhost', '/%2e%2E/foo'],
      ['https', 'localhost', '/caf%C3%A9'],
      ['https', 'localhost', '/foo%2fbar/..//baz'],
      ['https', 'localhost', '/foo?q=../bar'],
      ['https', 'localhost', '/path?q=hello%20world'],
      ['https', 'localhost', '/file.txt'],
      ['https', 'localhost', ''],
      ['http', 'localhost:080', '/foo.txt'],
      ['http', 'localhost:08080', '/foo.txt'],
      ['http', 'localhost:80', '/foo.txt'],
      ['https', 'localhost:80', '/foo.txt'],
      ['http', 'localhost:443', '/foo.txt'],
      ['https', 'localhost:443', '/foo.txt'],
      ['https', 'LOCALHOST', '/foo.txt'],
      ['https', 'LOCALHOST:80', '/foo.txt'],
      ['https', 'LOCALHOST:443', '/foo.txt'],
      ['https', 'LOCALHOST:8080', '/foo.txt'],
      ['https', 'Localhost:3000', '/foo.txt'],
    ])('Should successfully normalize `%s://%s%s`', async (scheme, host, path) => {
      expect(buildUrl(scheme, host, path)).toBe(new URL(path, `${scheme}://${host}`).href)
    })

    it('Should throw a RequestError for non-origin-form request-target', async () => {
      expect(() => {
        buildUrl('http', 'localhost', '*')
      }).toThrow(new RequestError('Invalid URL'))
    })

    it('Should throw a RequestError for invalid host header', async () => {
      expect(() => {
        buildUrl('http', 'localhost/foo', '/bar')
      }).toThrow(new RequestError('Invalid host header'))
    })
  })
})
