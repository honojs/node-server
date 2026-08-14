const LARGE_SIZE = 64 * 1024
const largeBody = new Uint8Array(LARGE_SIZE).fill(120)

export default {
  fetch: async (request) => {
    const url = new URL(request.url)

    if (request.method === 'HEAD' && url.pathname === '/empty') {
      return new Response(null, { status: 204 })
    }

    if (request.method === 'GET') {
      switch (url.pathname) {
        case '/':
          return new Response('Hi')
        case '/query':
          return new Response(`${url.searchParams.get('id')} ${url.searchParams.get('name')}`)
        case '/headers':
          return new Response(request.headers.get('x-test'), {
            headers: {
              'cache-control': 'public, max-age=60',
              'x-powered-by': 'benchmark',
            },
          })
        case '/json':
          return Response.json({ message: 'Hello!', ok: true })
        case '/large':
          return new Response(largeBody, {
            headers: { 'content-type': 'application/octet-stream' },
          })
        case '/stream':
          return new Response(
            new ReadableStream({
              start(controller) {
                for (let offset = 0; offset < LARGE_SIZE; offset += 8192) {
                  controller.enqueue(largeBody.subarray(offset, offset + 8192))
                }
                controller.close()
              },
            }),
            { headers: { 'content-type': 'application/octet-stream' } }
          )
      }
    }

    if (request.method === 'POST') {
      switch (url.pathname) {
        case '/json':
          return Response.json(await request.json())
        case '/upload': {
          const body = await request.arrayBuffer()
          return new Response(String(body.byteLength))
        }
      }
    }

    return new Response('Not Found', { status: 404 })
  },
}
