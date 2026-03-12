// Referring to https://github.com/SaltyAom/bun-http-framework-benchmark/blob/main/src/bun/bun-web-standard.ts

export default {
  fetch: async (request) => {
    const url = new URL(request.url)

    switch (request.method) {
      case 'GET':
        switch (url.pathname) {
          case '/':
            return new Response('Hi')
        }

        if (url.pathname.startsWith('/id/')) {
          const [id, rest] = url.pathname.slice(4).split('/')
          if (!rest)
            return new Response(`${id} ${url.searchParams.get('name')}`, {
              headers: {
                'x-powered-by': 'benchmark',
              },
            })
        }

        return new Response('Not Found', {
          status: 404,
        })

      case 'POST':
        switch (url.pathname) {
          case '/json':
            return Response.json(await request.json())

          default:
            return new Response('Not Found', {
              status: 404,
            })
        }

      default:
        return new Response('Not Found', {
          status: 404,
        })
    }
  },
}
