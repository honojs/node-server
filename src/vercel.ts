import type { Env, Hono } from 'hono'
import { getRequestListener } from './listener'

export const handle = <E extends Env, S extends {}, BasePath extends string>(
  app: Hono<E, S, BasePath>
) => {
  return getRequestListener(app.fetch)
}
