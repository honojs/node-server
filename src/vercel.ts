import type { Hono } from 'hono'
import { getRequestListener } from './listener'

export const handle = (app: Hono<any, any, any>) => {
  return getRequestListener(app.fetch)
}
