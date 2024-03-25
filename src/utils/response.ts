import { X_ALREADY_SENT } from './response/constants'
export const RESPONSE_ALREADY_SENT = new Response(null, {
  headers: { [X_ALREADY_SENT]: 'true' },
})
