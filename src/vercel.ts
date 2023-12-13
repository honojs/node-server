import type { Hono } from 'hono'
import { getRequestListener } from './listener'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const handle = (app: Hono<any, any, any>) => {
  return getRequestListener(app.fetch)
}
