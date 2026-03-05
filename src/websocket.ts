import type { UpgradeWebSocket } from 'hono/ws'
import { defineWebSocketHelper, WSContext } from 'hono/ws'
import type { RawData, WebSocket, WebSocketServer } from 'ws'
import type { IncomingMessage } from 'node:http'
import { STATUS_CODES } from 'node:http'
import type { Duplex } from 'node:stream'
import type { FetchCallback, ServerType } from './types'

interface CloseEventInit extends EventInit {
  code?: number
  reason?: string
  wasClean?: boolean
}

/**
 * @link https://developer.mozilla.org/en-US/docs/Web/API/CloseEvent
 */
export const CloseEvent: typeof globalThis.CloseEvent =
  globalThis.CloseEvent ??
  class extends Event {
    #eventInitDict

    constructor(type: string, eventInitDict: CloseEventInit = {}) {
      super(type, eventInitDict)
      this.#eventInitDict = eventInitDict
    }

    get wasClean(): boolean {
      return this.#eventInitDict.wasClean ?? false
    }

    get code(): number {
      return this.#eventInitDict.code ?? 0
    }

    get reason(): string {
      return this.#eventInitDict.reason ?? ''
    }
  }

const generateConnectionSymbol = () => Symbol('connection')

type WaitForWebSocket = (request: IncomingMessage, connectionSymbol: symbol) => Promise<WebSocket>

const CONNECTION_SYMBOL_KEY: unique symbol = Symbol('CONNECTION_SYMBOL_KEY')
const WAIT_FOR_WEBSOCKET_SYMBOL: unique symbol = Symbol('WAIT_FOR_WEBSOCKET_SYMBOL')

export type UpgradeBindings = {
  incoming: IncomingMessage
  outgoing: undefined
  wss: WebSocketServer
  [CONNECTION_SYMBOL_KEY]?: symbol
  [WAIT_FOR_WEBSOCKET_SYMBOL]?: WaitForWebSocket
}

type UpgradeWebSocketOptions = {
  onError: (err: unknown) => void
}

const rejectUpgradeRequest = (socket: Duplex, status: number) => {
  socket.end(
    `HTTP/1.1 ${status.toString()} ${STATUS_CODES[status] ?? ''}\r\n` +
      'Connection: close\r\n' +
      'Content-Length: 0\r\n' +
      '\r\n'
  )
}

const createUpgradeRequest = (request: IncomingMessage): Request => {
  const protocol = (request.socket as { encrypted?: boolean }).encrypted ? 'https' : 'http'
  const url = new URL(request.url ?? '/', `${protocol}://${request.headers.host ?? 'localhost'}`)
  const headers = new Headers()
  for (const key in request.headers) {
    const value = request.headers[key]
    if (!value) {
      continue
    }
    headers.append(key, Array.isArray(value) ? value[0] : value)
  }
  return new Request(url, {
    headers,
  })
}

export const setupWebSocket = (options: {
  server: ServerType,
  fetchCallback: FetchCallback,
  wss: WebSocketServer
}): void => {
  const { server, fetchCallback, wss } = options

  const waiterMap = new Map<
    IncomingMessage,
    { resolve: (ws: WebSocket) => void; connectionSymbol: symbol }
  >()
  
  wss.on('connection', (ws, request) => {
    const waiter = waiterMap.get(request)
    if (waiter) {
      waiter.resolve(ws)
      waiterMap.delete(request)
    }
  })

  const waitForWebSocket: WaitForWebSocket = (request, connectionSymbol) => {
    return new Promise<WebSocket>((resolve) => {
      waiterMap.set(request, { resolve, connectionSymbol })
    })
  }

  server.on('upgrade', async (request, socket: Duplex, head) => {
    if (request.headers.upgrade?.toLowerCase() !== 'websocket') {
      return
    }

    const env: UpgradeBindings = {
      incoming: request,
      outgoing: undefined,
      wss,
      [WAIT_FOR_WEBSOCKET_SYMBOL]: waitForWebSocket,
    }

    let status = 400
    try {
      const response = (await fetchCallback(
        createUpgradeRequest(request),
        env as unknown as Parameters<FetchCallback>[1]
      )) as Response
      if (response instanceof Response) {
        status = response.status
      }
    } catch {
      if (server.listenerCount('upgrade') === 1) {
        rejectUpgradeRequest(socket, 500)
      }
      return
    }

    const waiter = waiterMap.get(request)

    if (!waiter || waiter.connectionSymbol !== env[CONNECTION_SYMBOL_KEY]) {
      waiterMap.delete(request)
      if (server.listenerCount('upgrade') === 1) {
        rejectUpgradeRequest(socket, status)
      }
      return
    }

    wss.handleUpgrade(request, socket, head, (ws) => {
      wss.emit('connection', ws, request)
    })
  })

  server.on('close', () => {
    wss.close()
  })
}

export const upgradeWebSocket: UpgradeWebSocket<WebSocket, UpgradeWebSocketOptions> =
  defineWebSocketHelper(async (c, events, options) => {
    if (c.req.header('upgrade')?.toLowerCase() !== 'websocket') {
      return
    }

    const env = c.env as UpgradeBindings
    const waitForWebSocket = env[WAIT_FOR_WEBSOCKET_SYMBOL]

    if (!waitForWebSocket || !env.incoming) {
      return new Response(null, { status: 500 })
    }

    const connectionSymbol = generateConnectionSymbol()
    env[CONNECTION_SYMBOL_KEY] = connectionSymbol
    ;(async () => {
      const ws = await waitForWebSocket(env.incoming, connectionSymbol)

      const messagesReceivedInStarting: [data: RawData, isBinary: boolean][] = []
      const bufferMessage = (data: RawData, isBinary: boolean) => {
        messagesReceivedInStarting.push([data, isBinary])
      }
      ws.on('message', bufferMessage)

      const ctx: WSContext<WebSocket> = {
        binaryType: 'arraybuffer',
        close(code, reason) {
          ws.close(code, reason)
        },
        protocol: ws.protocol,
        raw: ws,
        get readyState() {
          return ws.readyState
        },
        send(source, opts) {
          ws.send(source, {
            compress: opts?.compress,
          })
        },
        url: new URL(c.req.url),
      }

      try {
        events?.onOpen?.(new Event('open'), ctx)
      } catch (e) {
        ;(options?.onError ?? console.error)(e)
      }

      const handleMessage = (data: RawData, isBinary: boolean) => {
        const datas = Array.isArray(data) ? data : [data]
        for (const data of datas) {
          try {
            events?.onMessage?.(
              new MessageEvent('message', {
                data: isBinary
                  ? data instanceof ArrayBuffer
                    ? data
                    : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
                  : data.toString('utf-8'),
              }),
              ctx
            )
          } catch (e) {
            ;(options?.onError ?? console.error)(e)
          }
        }
      }

      ws.off('message', bufferMessage)
      for (const message of messagesReceivedInStarting) {
        handleMessage(...message)
      }

      ws.on('message', (data, isBinary) => {
        handleMessage(data, isBinary)
      })

      ws.on('close', (code, reason) => {
        try {
          events?.onClose?.(new CloseEvent('close', { code, reason: reason.toString() }), ctx)
        } catch (e) {
          ;(options?.onError ?? console.error)(e)
        }
      })

      ws.on('error', (error) => {
        try {
          events?.onError?.(
            new ErrorEvent('error', {
              error,
            }),
            ctx
          )
        } catch (e) {
          ;(options?.onError ?? console.error)(e)
        }
      })
    })()

    return new Response()
  })
