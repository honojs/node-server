import { once } from 'node:events'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'
import { getRequestListener } from '../src/listener'
import {
  GlobalResponse,
  Response as LightweightResponse,
  cacheKey,
  copyHeaders,
  consumeSharedBody,
} from '../src/response'

const copy = LightweightResponse[copyHeaders]
const light = (body: BodyInit | null, init?: ResponseInit) =>
  new LightweightResponse(body, init) as unknown as Response

describe('Response header copies', () => {
  it('preserves saved response state after real HTTP writes', async () => {
    const states = []
    for (const optimized of [false, true]) {
      let saved: Response
      const server = createServer(
        getRequestListener(
          () => {
            saved = light('héllo')
            const response = optimized ? copy(saved)! : new GlobalResponse(saved.body, saved)
            response.headers.append('set-cookie', 'a=1')
            response.headers.append('set-cookie', 'b=2')
            response.headers.set('x-after', 'yes')
            return response
          },
          { overrideGlobalObjects: false }
        )
      )
      try {
        server.listen(0, '127.0.0.1')
        await once(server, 'listening')
        const url = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
        for (const method of ['GET', 'HEAD']) {
          const response = await fetch(url, { method })
          const text = await response.text()
          states.push({
            method,
            text,
            headers: [...response.headers].filter(([key]) => key !== 'date'),
            savedHeaders: [...saved!.headers],
            used: saved!.bodyUsed,
            locked: saved!.body!.locked,
          })
        }
      } finally {
        server.closeAllConnections()
        await new Promise<void>((resolve, reject) =>
          server.close((error) => (error ? reject(error) : resolve()))
        )
      }
    }
    expect(states.slice(2)).toEqual(states.slice(0, 2))
  })

  it('keeps strings buffered while copying headers independently', async () => {
    const original = light('héllo', { headers: { 'x-original': 'yes' } })
    const saved = original.headers
    const replacement = copy(original)!
    expect(cacheKey in original).toBe(true)
    expect(cacheKey in replacement).toBe(true)
    replacement.headers.set('x-after', 'yes')
    saved.set('x-saved', 'yes')
    expect(replacement.headers.get('x-saved')).toBeNull()
    expect(original.headers.get('x-after')).toBeNull()
    expect(replacement.headers.get('content-type')).toBe('text/plain;charset=UTF-8')
    expect(await replacement.text()).toBe('héllo')
    expect(original.bodyUsed).toBe(true)
    await expect(original.text()).rejects.toThrow(TypeError)
  })

  it.each(['original', 'replacement', 'clone', 'locked'] as const)(
    'preserves native shared-body semantics when observing %s first',
    async (observe) => {
      const results = []
      for (const optimized of [false, true]) {
        const original = light('value')
        const replacement = optimized
          ? copy(original)!
          : new GlobalResponse(original.body, original)
        const read = async (response: Response) => {
          try {
            return await response.text()
          } catch (error) {
            return (error as Error).name
          }
        }
        let values: string[]
        if (observe === 'clone') {
          values = [await read(original.clone()), await read(replacement), await read(original)]
        } else if (observe === 'locked') {
          const reader = original.body!.getReader()
          values = [await read(replacement)]
          reader.releaseLock()
        } else {
          const first = observe === 'original' ? original : replacement
          const second = observe === 'original' ? replacement : original
          values = [await read(first), await read(second)]
        }
        results.push({
          values,
          used: original.bodyUsed,
          shared: original.body === replacement.body,
        })
      }
      expect(results[1]).toEqual(results[0])
    }
  )

  it('materializes all saved wrappers on body observation', () => {
    const original = light('value')
    const replacement = copy(copy(original)!)!
    expect(replacement.body).toBe(original.body)
    expect(cacheKey in original).toBe(false)
    expect(cacheKey in replacement).toBe(false)
  })

  it('preserves consumption after a buffered send', async () => {
    const original = light('value')
    const replacement = copy(original)!
    expect(consumeSharedBody(replacement)).toBe(true)
    expect(original.bodyUsed).toBe(true)
    expect(original.body!.locked).toBe(true)
    await expect(replacement.text()).rejects.toThrow(TypeError)
  })

  it('materializes on a repeated send instead of reusing buffered bytes', () => {
    const replacement = copy(light('value'))!
    expect(consumeSharedBody(replacement)).toBe(true)
    expect(consumeSharedBody(replacement)).toBe(false)
    expect(cacheKey in replacement).toBe(false)
    expect(replacement.bodyUsed).toBe(true)
  })

  it('preserves null bodies and duplicate cookies', async () => {
    const original = light(null, { status: 204 })
    original.headers.append('set-cookie', 'a=1')
    original.headers.append('set-cookie', 'b=2')
    const replacement = copy(original)!
    expect(replacement.headers.getSetCookie()).toEqual(['a=1', 'b=2'])
    expect(replacement.headers.has('content-type')).toBe(false)
    expect(replacement.status).toBe(204)
    expect(await replacement.text()).toBe('')
    expect(original.bodyUsed).toBe(false)
  })

  it('bounds the number of deferred wrappers', () => {
    let response = light('value')
    for (let i = 0; i < 63; i++) {
      response = copy(response)!
      expect(response).toBeDefined()
    }
    expect(copy(response)).toBeUndefined()
    expect(new GlobalResponse(response.body, response).body).toBe(response.body)
  })

  it('declines native responses, subclasses, streams, byte arrays and observed bodies', () => {
    const observed = light('value')
    void observed.body
    for (const response of [
      new GlobalResponse('value'),
      new (class extends LightweightResponse {})('value') as unknown as Response,
      light(new Uint8Array([1])),
      light(
        new ReadableStream({
          start(controller) {
            controller.close()
          },
        })
      ),
      observed,
      light('value', { statusText: 'Custom' }),
      light('value', {
        get status() {
          return 200
        },
      }),
    ]) {
      expect(copy(response)).toBeUndefined()
    }
  })

  it('does not invoke proxy traps, response properties or forged per-response hooks', () => {
    const original = light('value')
    const trap = vi.fn(() => {
      throw new Error('unexpected access')
    })
    expect(copy(new Proxy(original, { get: trap, getPrototypeOf: trap }))).toBeUndefined()
    expect(trap).not.toHaveBeenCalled()
    Object.defineProperty(original, Symbol.for('hono.response.copyHeaders'), { value: trap })
    expect(copy(original)).toBeDefined()
    expect(trap).not.toHaveBeenCalled()
    const customized = light('value')
    Object.defineProperty(customized, 'body', { get: trap })
    expect(copy(customized)).toBeUndefined()
    expect(trap).not.toHaveBeenCalled()
    expect(copy(Object.create(LightweightResponse.prototype))).toBeUndefined()
  })
})
