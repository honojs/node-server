import { createServer } from 'node:http'

const LARGE_SIZE = 64 * 1024
const largeBody = new Uint8Array(LARGE_SIZE).fill(120)

createServer((request, response) => {
  const url = new URL(request.url, 'http://localhost')

  if (request.method === 'HEAD' && url.pathname === '/empty') {
    response.writeHead(204).end()
    return
  }

  if (request.method === 'GET') {
    switch (url.pathname) {
      case '/':
        response.end('Hi')
        return
      case '/query':
        response.end(`${url.searchParams.get('id')} ${url.searchParams.get('name')}`)
        return
      case '/headers':
        response.setHeader('cache-control', 'public, max-age=60')
        response.setHeader('x-powered-by', 'benchmark')
        response.end(request.headers['x-test'])
        return
      case '/json':
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify({ message: 'Hello!', ok: true }))
        return
      case '/large':
        response.setHeader('content-type', 'application/octet-stream')
        response.end(largeBody)
        return
      case '/stream':
        response.setHeader('content-type', 'application/octet-stream')
        for (let offset = 0; offset < LARGE_SIZE; offset += 8192) {
          response.write(largeBody.subarray(offset, offset + 8192))
        }
        response.end()
        return
    }
  }

  if (request.method === 'POST' && (url.pathname === '/json' || url.pathname === '/upload')) {
    const chunks = []
    request.on('data', (chunk) => chunks.push(chunk))
    request.on('end', () => {
      const body = Buffer.concat(chunks)
      if (url.pathname === '/json') {
        response.setHeader('content-type', 'application/json')
        response.end(JSON.stringify(JSON.parse(body.toString())))
      } else {
        response.end(String(body.byteLength))
      }
    })
    return
  }

  response.writeHead(404).end('Not Found')
}).listen(3000)
