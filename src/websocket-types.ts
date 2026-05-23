/**
 * This is the minimal public interface for WebSocket that is compatible with `ws` (`@types/ws`)
 * https://github.com/DefinitelyTyped/DefinitelyTyped/blob/master/types/ws/index.d.ts
 *
 * If you need more methods, copy the extra types over from the types file linked above.
 * Don't import types from `ws` directly, as it will cause issues with users who have `skipLibCheck` enabled.
 * See https://github.com/honojs/node-server/issues/353 for more details.
 */
import type { IncomingMessage } from 'node:http'
import type { Duplex } from 'node:stream'

type WSReadyState = 0 | 1 | 2 | 3

export type WebSocketData = string | ArrayBuffer | Uint8Array | readonly Uint8Array[]

export type WebSocketSendOptions = {
  compress?: boolean
}

export interface WebSocketLike {
  protocol: string
  readyState: WSReadyState
  close(code?: number, reason?: string): void
  send(data: string | ArrayBuffer | ArrayBufferView, options?: WebSocketSendOptions): void
  on(event: 'message', listener: (data: WebSocketData, isBinary: boolean) => void): this
  on(event: 'close', listener: (code: number, reason: Uint8Array) => void): this
  on(event: 'error', listener: (error: unknown) => void): this
  off(event: 'message', listener: (data: WebSocketData, isBinary: boolean) => void): this
}

export interface WebSocketServerLike {
  options: {
    noServer?: boolean
  }
  on(event: 'connection', listener: (ws: WebSocketLike, request: IncomingMessage) => void): this
  on(event: 'headers', listener: (headers: string[]) => void): this
  off(event: 'headers', listener: (headers: string[]) => void): this
  emit(event: 'connection', ws: WebSocketLike, request: IncomingMessage): boolean
  handleUpgrade(
    request: IncomingMessage,
    socket: Duplex,
    head: Buffer,
    callback: (ws: WebSocketLike) => void
  ): void
  close(): void
}
