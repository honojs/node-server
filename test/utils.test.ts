import { Writable } from 'node:stream'
import { buildOutgoingHttpHeaders, writeFromReadableStream } from '../src/utils'

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
