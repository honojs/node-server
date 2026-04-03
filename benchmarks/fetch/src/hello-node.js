import { createServer } from 'node:http'

const body = JSON.stringify({ hello: 'world' })

createServer((_, res) => {
  res.writeHead(200, {
    'content-type': 'application/json',
    'content-length': body.length,
  })
  res.end(body)
}).listen(3000, '127.0.0.1', () => {
  console.log('Listening on http://localhost:3000')
})
