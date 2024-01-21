import type { IncomingMessage } from 'node:http'
import { newRequest } from '../src/request'

describe('Request', () => {
  it('Compatibility with standard Request object', async () => {
    const req = newRequest({
      method: 'GET',
      url: '/',
      headers: {
        host: 'localhost',
      },
      rawHeaders: ['host', 'localhost'],
    } as IncomingMessage)

    expect(req).toBeInstanceOf(global.Request)
    expect(req.method).toBe('GET')
    expect(req.url).toBe('http://localhost/')
    expect(req.headers.get('host')).toBe('localhost')
  })

  it('Should resolve double dots in URL', async () => {
    const req = newRequest({
      headers: {
        host: 'localhost',
      },
      url: '/static/../foo.txt',
    } as IncomingMessage)
    expect(req).toBeInstanceOf(global.Request)
    expect(req.url).toBe('http://localhost/foo.txt')
    // Check if cached value is returned correctly
    expect(req.url).toBe('http://localhost/foo.txt')
  })
})
