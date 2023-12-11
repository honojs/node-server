import { createServer, type Server } from 'node:http'
import { AddressInfo } from 'node:net'
import { GlobalResponse } from '../src/response'

class NextResponse extends Response {}

describe('Response', () => {
  let server: Server
  let port: number
  beforeAll(
    async () =>
      new Promise<void>((resolve) => {
        server = createServer((_, res) => {
          res.writeHead(200, {
            'Content-Type': 'application/json charset=UTF-8',
          })
          res.end(JSON.stringify({ status: 'ok' }))
        })
          .listen(0)
          .on('listening', () => {
            port = (server.address() as AddressInfo).port
            resolve()
          })
      })
  )

  afterAll(() => {
    server.close()
  })

  it('Compatibility with standard Response object', async () => {
    // response name not changed
    expect(Response.name).toEqual('Response')

    // response prototype chain not changed
    expect(new Response()).toBeInstanceOf(GlobalResponse)

    // `fetch()` and `Response` are not changed
    const fetchRes = await fetch(`http://localhost:${port}`)
    expect(new Response()).toBeInstanceOf(fetchRes.constructor)
    const resJson = await fetchRes.json()
    expect(fetchRes.headers.get('content-type')).toEqual('application/json charset=UTF-8')
    expect(resJson).toEqual({ status: 'ok' })

    // can only use new operator
    expect(() => {
      ;(Response as any)()
    }).toThrow()

    // support Response static method
    expect(Response.error).toEqual(expect.any(Function))
    expect(Response.json).toEqual(expect.any(Function))
    expect(Response.redirect).toEqual(expect.any(Function))

    // support other class to extends from Response
    expect(new NextResponse()).toBeInstanceOf(Response)
  })
})
