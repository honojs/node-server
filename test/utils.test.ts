import { Writable } from 'node:stream'
import {
  buildOutgoingHttpHeaders,
  writeFromReadableStream,
  readWithoutBlocking,
} from '../src/utils'

describe('buildOutgoingHttpHeaders', () => {
  it('original content-type is preserved', () => {
    const headers = new Headers({
      a: 'b',
      'content-type': 'text/html; charset=UTF-8',
    })
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/html; charset=UTF-8',
    })
  })

  it('multiple set-cookie', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'a')
    headers.append('set-cookie', 'b')
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      'set-cookie': ['a', 'b'],
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Headers', () => {
    const headers = new Headers({
      a: 'b',
    })
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Record<string, string>', () => {
    const headers = {
      a: 'b',
      'Set-Cookie': 'c', // case-insensitive
    }
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'set-cookie': ['c'],
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Record<string, string>[]', () => {
    const headers: HeadersInit = [['a', 'b']]
    const result = buildOutgoingHttpHeaders(headers)
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('null', () => {
    const result = buildOutgoingHttpHeaders(null)
    expect(result).toEqual({
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('undefined', () => {
    const result = buildOutgoingHttpHeaders(undefined)
    expect(result).toEqual({
      'content-type': 'text/plain; charset=UTF-8',
    })
  })
})

describe('writeFromReadableStream', () => {
  it('should handle client disconnection gracefully without canceling stream', async () => {
    let enqueueCalled = false
    let cancelCalled = false

    // Create test ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        setTimeout(() => {
          try {
            controller.enqueue(new TextEncoder().encode('test'))
            enqueueCalled = true
          } catch {
            // Test should fail if error occurs
          }
          controller.close()
        }, 100)
      },
      cancel() {
        cancelCalled = true
      },
    })

    // Test Writable stream
    const writable = new Writable()

    // Simulate client disconnection after 50ms
    setTimeout(() => {
      writable.destroy()
    }, 50)

    await writeFromReadableStream(stream, writable)

    expect(enqueueCalled).toBe(true) // enqueue should succeed
    expect(cancelCalled).toBe(false) // cancel should not be called
  })
})

describe('readWithoutBlocking', () => {
  const encode = (body: string) => new TextEncoder().encode(body)
  it('should return the body for simple text', async () => {
    const text = 'Hello! Node!'
    const response = new Response(text)
    const reader = response.body!.getReader()
    const firstChunk = await readWithoutBlocking(reader.read())
    expect(firstChunk).toEqual({ done: false, value: encode(text) })
    const secondChunk = await readWithoutBlocking(reader.read())
    expect(secondChunk).toEqual({ done: true, value: undefined })
  })

  it('should return the body for large text', async () => {
    const text = 'a'.repeat(1024 * 1024 * 10)
    const response = new Response(text)
    const reader = response.body!.getReader()
    const firstChunk = await readWithoutBlocking(reader.read())
    expect(firstChunk?.done).toBe(false)
    expect(firstChunk?.value?.length).toEqual(10 * 1024 * 1024)
    const secondChunk = await readWithoutBlocking(reader.read())
    expect(secondChunk).toEqual({ done: true, value: undefined })
  })

  it('should return the body simple synchronous readable stream', async () => {
    const text = 'Hello! Node!'
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(encode(text))
        controller.close()
      },
    })
    const response = new Response(body)
    const reader = response.body!.getReader()
    const result = await readWithoutBlocking(reader.read())
    expect(result).toEqual({ done: false, value: encode(text) })
  })

  it('should return undefined if stream is not ready', async () => {
    const text = 'Hello! Node!'
    const body = new ReadableStream({
      async start(controller) {
        await new Promise((resolve) => setTimeout(resolve))
        controller.enqueue(encode(text))
        controller.close()
      },
    })
    const response = new Response(body)
    const reader = response.body!.getReader()
    const readPromise = reader.read()

    const result = await readWithoutBlocking(readPromise)
    expect(result).toBeUndefined()

    await new Promise((resolve) => setTimeout(resolve))
    const result2 = await readWithoutBlocking(readPromise)
    expect(result2).toEqual({ done: false, value: encode(text) })
    const result3 = await readWithoutBlocking(reader.read())
    expect(result3).toEqual({ done: true, value: undefined })
  })

  it('should return undefined if stream is closed', async () => {
    const body = new ReadableStream({
      async start() {
        throw new Error('test')
      },
    })
    const response = new Response(body)
    const reader = response.body!.getReader()
    const readPromise = reader.read()

    const result = await readWithoutBlocking(readPromise)
    expect(result).toBeUndefined()
  })

  it('should return undefined if stream is errored', async () => {
    const body = new ReadableStream({
      pull() {
        throw new Error('test')
      },
    })
    const response = new Response(body)
    const reader = response.body!.getReader()
    const readPromise = reader.read()

    const result = await readWithoutBlocking(readPromise).catch(() => undefined)
    expect(result).toBeUndefined()
  })
})
