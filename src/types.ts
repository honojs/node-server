export type FetchCallback = (request: Request) => Promise<unknown> | unknown

export type NextHandlerOption = {
  fetch: FetchCallback
}

export type Options = {
  fetch: FetchCallback
  port?: number
  hostname?: string
  serverOptions?: Object
}
