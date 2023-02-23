import type { NextApiHandler } from 'next/types'
import { installGlobals } from './globals'
import { getRequestListener } from './listener'
import { NextHandlerOption } from './types'

installGlobals()

export function handle(app: NextHandlerOption): NextApiHandler {
  return getRequestListener(app.fetch)
}
