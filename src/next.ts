import type { NextApiHandler } from 'next/types'
import { getRequestListener } from './listener'
import { NextHandlerOption } from './types'

export function handle(app: NextHandlerOption): NextApiHandler {
  return getRequestListener(app.fetch)
}
