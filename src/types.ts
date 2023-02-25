import type { Hono } from 'hono'
import type { NextApiHandler } from 'next/types'

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

export interface HandleInterface {
  <E extends Hono<any, any>>(subApp: E, path?: string): NextApiHandler
}
