import type { Env, Hono } from 'hono'
import { getRequestListener } from './listener'
import { NextApiHandler } from 'next/types'

export const handle = <E extends Env, S extends {}, BasePath extends string>(
  app: Hono<E, S, BasePath>
): NextApiHandler => {
  return getRequestListener(app.fetch)
}
