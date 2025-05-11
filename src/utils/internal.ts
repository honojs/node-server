export interface InternalBody {
  source: string | Uint8Array | FormData | Blob | null
  stream: ReadableStream
  length: number | null
}

// XXX: share "getResponseState" function by symbols via the global object to ensure more reliable.
let getResponseStateFn: (res: Response) => { body: InternalBody } | undefined
const getResponseStateKey = Symbol.for('@hono/node-server/getResponseState')
export const setGetResponseStateFn = (fn: typeof getResponseStateFn) =>
  ((global as unknown as { [getResponseStateKey]: typeof getResponseStateFn })[
    getResponseStateKey
  ] = fn)

// prior to v24, internal state could be obtained from the Response object via a symbol.
if (parseInt(process.version.slice(1).split('.')[0]) < 24) {
  const stateKey = Reflect.ownKeys(new global.Response()).find(
    (k) => typeof k === 'symbol' && k.toString() === 'Symbol(state)'
  ) as symbol
  getResponseStateFn = (res) => {
    return (res as unknown as { [stateKey: symbol]: { body: InternalBody } })[stateKey]
  }
}
// after v24, internal state can only be obtained from internal function.

export const getResponseState = (res: Response) => {
  if (!getResponseStateFn) {
    // after v24
    getResponseStateFn = (
      global as unknown as { [getResponseStateKey]: typeof getResponseStateFn }
    )[getResponseStateKey]

    if (!getResponseStateFn) {
      // use "--import @hono/node-server/setup" if your app needs to optimize with internal state.
      getResponseStateFn = () => undefined
    }
  }
  return getResponseStateFn(res)
}
