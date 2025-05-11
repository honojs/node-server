import { setGetResponseStateFn } from './utils/internal'

const originalDeleteProperty = Reflect.deleteProperty
export let getResponseState: Parameters<typeof setGetResponseStateFn>[0] | undefined
Reflect.deleteProperty = (target, prop) => {
  if (prop === 'getResponseState') {
    getResponseState = (target as { getResponseState: Parameters<typeof setGetResponseStateFn>[0] })
      .getResponseState
    setGetResponseStateFn(getResponseState)
    Reflect.deleteProperty = originalDeleteProperty
  }
  return originalDeleteProperty(target, prop)
}
Response
