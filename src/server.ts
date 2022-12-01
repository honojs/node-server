import { createServer, Server, IncomingMessage, ServerResponse } from 'node:http'

import { Response } from './fetch'
import { writeReadableStreamToWritable } from './stream'
import { installGlobals } from './globals'

installGlobals()

type FetchCallback = (request: Request) => Promise<unknown> | unknown

type Options = {
  fetch: FetchCallback
  port?: number
  serverOptions?: Object
}

export const createAdaptorServer = (options: Options): Server => {
  const fetchCallback = options.fetch
  const requestListener = getRequestListener(fetchCallback)
  const server: Server = createServer(options.serverOptions || {}, requestListener)
  return server
}

export const serve = (options: Options): Server => {
  const server = createAdaptorServer(options)
  server.listen(options.port || 3000)
  return server
}

const getRequestListener = (fetchCallback: FetchCallback) => {
  return async (incoming: IncomingMessage, outgoing: ServerResponse) => {
    const method = incoming.method || 'GET'
    const url = `http://${incoming.headers.host}${incoming.url}`

    const headerRecord: Record<string, string> = {}
    const len = incoming.rawHeaders.length
    for (let i = 0; i < len; i++) {
      if (i % 2 === 0) {
        const key = incoming.rawHeaders[i]
        headerRecord[key] = incoming.rawHeaders[i + 1]
      }
    }

    const init = {
      method: method,
      headers: headerRecord,
    } as RequestInit

    if (!(method === 'GET' || method === 'HEAD')) {
      const buffers = []
      for await (const chunk of incoming) {
        buffers.push(chunk)
      }
      const buffer = Buffer.concat(buffers)
      init['body'] = buffer
    }

    let res: Response

    try {
      res = (await fetchCallback(new Request(url.toString(), init))) as Response
    } catch {
      res = new Response(null, { status: 500 })
    }

    const contentType = res.headers.get('content-type') || ''
    const contentEncoding = res.headers.get('content-encoding')

    for (const [k, v] of res.headers) {
      if (k === 'set-cookie') {
        outgoing.setHeader(k, res.headers.getAll(k))
      } else {
        outgoing.setHeader(k, v)
      }
    }
    outgoing.statusCode = res.status

    if (res.body) {
      if (!contentEncoding && contentType.startsWith('text')) {
        outgoing.end(await res.text())
      } else if (!contentEncoding && contentType.startsWith('application/json')) {
        outgoing.end(await res.text())
      } else {
        await writeReadableStreamToWritable(res.body, outgoing)
      }
    } else {
      outgoing.end()
    }
  }
}
