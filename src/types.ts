import type {
  createServer,
  IncomingMessage,
  Server,
  ServerOptions as HttpServerOptions,
  ServerResponse as HttpServerResponse,
} from 'node:http'
import type {
  createSecureServer as createSecureHttp2Server,
  createServer as createHttp2Server,
  Http2ServerRequest,
  Http2Server,
  Http2ServerResponse,
  Http2SecureServer,
  SecureServerOptions as SecureHttp2ServerOptions,
  ServerOptions as Http2ServerOptions,
} from 'node:http2'
import type {
  createServer as createHttpsServer,
  ServerOptions as HttpsServerOptions,
} from 'node:https'

export type HttpBindings = {
  incoming: IncomingMessage
  outgoing: HttpServerResponse
}

export type Http2Bindings = {
  incoming: Http2ServerRequest
  outgoing: Http2ServerResponse
}

export type FetchCallback = (
  request: Request,
  env: HttpBindings | Http2Bindings
) => Promise<unknown> | unknown

export type NextHandlerOption = {
  fetch: FetchCallback
}

export type ServerType = Server | Http2Server | Http2SecureServer

type createHttpOptions = {
  serverOptions?: HttpServerOptions
  createServer?: typeof createServer
}

type createHttpsOptions = {
  serverOptions?: HttpsServerOptions
  createServer?: typeof createHttpsServer
}

type createHttp2Options = {
  serverOptions?: Http2ServerOptions
  createServer?: typeof createHttp2Server
}

type createSecureHttp2Options = {
  serverOptions?: SecureHttp2ServerOptions
  createServer?: typeof createSecureHttp2Server
}

export type ServerOptions =
  | createHttpOptions
  | createHttpsOptions
  | createHttp2Options
  | createSecureHttp2Options

export type Options = {
  fetch: FetchCallback
  overrideGlobalObjects?: boolean
  autoCleanupIncoming?: boolean
  port?: number
  hostname?: string
} & ServerOptions

export type CustomErrorHandler = (err: unknown) => void | Response | Promise<void | Response>
