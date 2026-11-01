import { Writable } from 'node:stream'
import { queryObjects } from 'node:v8'
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
    const result = buildOutgoingHttpHeaders(headers, 'text/plain; charset=UTF-8')
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/html; charset=UTF-8',
    })
  })

  it('multiple set-cookie with default content-type', () => {
    const headers = new Headers()
    headers.append('set-cookie', 'a')
    headers.append('set-cookie', 'b')
    const result = buildOutgoingHttpHeaders(headers, 'text/plain; charset=UTF-8')
    expect(result).toEqual({
      'set-cookie': ['a', 'b'],
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Headers with default content-type', () => {
    const headers = new Headers({
      a: 'b',
    })
    const result = buildOutgoingHttpHeaders(headers, 'text/plain; charset=UTF-8')
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Record<string, string> with default content-type', () => {
    const headers = {
      a: 'b',
      'Set-Cookie': 'c', // case-insensitive
    }
    const result = buildOutgoingHttpHeaders(headers, 'text/plain; charset=UTF-8')
    expect(result).toEqual({
      a: 'b',
      'set-cookie': ['c'],
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('Record<string, string>[] with default content-type', () => {
    const headers: HeadersInit = [['a', 'b']]
    const result = buildOutgoingHttpHeaders(headers, 'text/plain; charset=UTF-8')
    expect(result).toEqual({
      a: 'b',
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('null without default content-type', () => {
    const result = buildOutgoingHttpHeaders(null, undefined)
    expect(result).toEqual({})
  })

  it('undefined without default content-type', () => {
    const result = buildOutgoingHttpHeaders(undefined, undefined)
    expect(result).toEqual({})
  })

  it('null with default content-type', () => {
    const result = buildOutgoingHttpHeaders(null, 'text/plain; charset=UTF-8')
    expect(result).toEqual({
      'content-type': 'text/plain; charset=UTF-8',
    })
  })

  it('does not override existing content-type when default is provided', () => {
    const result = buildOutgoingHttpHeaders(
      {
        'content-type': 'application/json',
      },
      'text/plain; charset=UTF-8'
    )
    expect(result).toEqual({
      'content-type': 'application/json',
    })
  })
})

describe('writeFromReadableStream', () => {
  it('should handle client disconnection', async () => {
    let enqueueCalled = false
    let cancelCalled = false
    let enqueueTimeout: NodeJS.Timeout | undefined

    // Create test ReadableStream
    const stream = new ReadableStream({
      start(controller) {
        enqueueTimeout = setTimeout(() => {
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
        clearTimeout(enqueueTimeout)
      },
    })

    // Test Writable stream
    const writable = new Writable()

    // Simulate client disconnection after 50ms
    setTimeout(() => {
      writable.destroy()
    }, 50)

    await writeFromReadableStream(stream, writable)

    expect(enqueueCalled).toBe(false) // enqueue should not be called
    expect(cancelCalled).toBe(true) // cancel should be called
  })
})

describe('writeFromReadableStream with a paced source', () => {
  it('should not keep a promise for each chunk while the stream is open', async () => {
    const total = 1000
    const encode = new TextEncoder()
    const countPromises = () => queryObjects(Promise, { format: 'count' })

    let sent = 0
    let baseline = 0
    let live = 0
    const stream = new ReadableStream<Uint8Array>({
      async pull(controller) {
        // let the previous chunk be written and its read be settled before producing the next one
        await new Promise((resolve) => setImmediate(resolve))
        if (sent === 100) {
          baseline = countPromises()
        }
        if (sent === total - 1) {
          live = countPromises()
        }
        if (sent++ < total) {
          controller.enqueue(encode.encode('x'))
        } else {
          controller.close()
        }
      },
    })

    // a large highWaterMark keeps `write()` returning `true`, like a socket that never fills up
    const writable = new Writable({
      highWaterMark: 1024 * 1024,
      write(_chunk, _encoding, callback) {
        callback()
      },
    })

    await writeFromReadableStream(stream, writable)

    expect(baseline).toBeGreaterThan(0)
    // before the fix, about one promise per chunk (~900) stayed alive between the two samples
    expect(live - baseline).toBeLessThan(100)
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

  it('should return undefined value if stream is closed in start', async () => {
    const body = new ReadableStream({
      async start(controller) {
        controller.close()
      },
    })

    const response = new Response(body)
    const reader = response.body!.getReader()
    const readPromise = reader.read()

    const result = await readWithoutBlocking(readPromise)
    expect(result).toEqual({ done: true, value: undefined })
  })

  it('should return undefined if stream is errored in start', async () => {
    const body = new ReadableStream({
      async start() {
        throw new Error('test')
      },
    })
    const response = new Response(body)
    const reader = response.body!.getReader()
    const readPromise = reader.read()

    await expect(readWithoutBlocking(readPromise)).rejects.toThrow('test')
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

    await expect(readWithoutBlocking(readPromise)).rejects.toThrow('test')
  })
})
