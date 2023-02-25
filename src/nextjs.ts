import { Hono } from 'hono'
import { getRequestListener } from './listener'
import { HandleInterface } from './types'

// <E extends Hono<any, any>
export const handle: HandleInterface = <E extends Hono<any, any>>(
  subApp: E,
  path: string = '/'
) => {
  return getRequestListener(new Hono().route(path, subApp).fetch)
}
