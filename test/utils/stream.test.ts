import { EventEmitter } from 'node:events'
import type { ReadStream } from 'node:fs'
import { createStreamBody } from '../../src/utils/stream'

class FakeReadStream extends EventEmitter {
  pause = vi.fn(() => this)
  resume = vi.fn(() => this)
  destroy = vi.fn(() => this)
}

const asReadStream = (stream: FakeReadStream) => stream as unknown as ReadStream

describe('createStreamBody fallback', () => {
  it('pauses the node stream when the web stream queue is full and resumes on pull', async () => {
    const stream = new FakeReadStream()
    const body = createStreamBody(asReadStream(stream), false)
    const pauseCallsAfterStart = stream.pause.mock.calls.length

    stream.emit('data', Buffer.from('a'))

    expect(stream.pause.mock.calls.length).toBeGreaterThan(pauseCallsAfterStart)

    const reader = body.getReader()
    const resumeCallsBeforeRead = stream.resume.mock.calls.length
    const result = await reader.read()
    await Promise.resolve()

    expect(result.done).toBe(false)
    expect(Buffer.from(result.value ?? []).toString()).toBe('a')
    expect(stream.resume.mock.calls.length).toBeGreaterThan(resumeCallsBeforeRead)

    await reader.cancel()
  })

  it('destroys the node stream on cancel and ignores later terminal events', async () => {
    const stream = new FakeReadStream()
    const body = createStreamBody(asReadStream(stream), false)
    const reader = body.getReader()

    await reader.cancel()

    expect(stream.destroy).toHaveBeenCalledTimes(1)
    expect(stream.listenerCount('data')).toBe(0)
    expect(stream.listenerCount('end')).toBe(0)
    expect(() => stream.emit('end')).not.toThrow()
    expect(() => stream.emit('error', new Error('late error'))).not.toThrow()

    stream.emit('close')
    expect(stream.listenerCount('error')).toBe(0)
  })

  it('propagates node stream errors to the web stream reader', async () => {
    const stream = new FakeReadStream()
    const body = createStreamBody(asReadStream(stream), false)
    const reader = body.getReader()
    const error = new Error('read failed')
    const readPromise = reader.read()

    stream.emit('error', error)

    await expect(readPromise).rejects.toBe(error)
  })

  it('closes the web stream on end and ignores a later close event', async () => {
    const stream = new FakeReadStream()
    const body = createStreamBody(asReadStream(stream), false)
    const reader = body.getReader()
    const readPromise = reader.read()

    stream.emit('end')

    await expect(readPromise).resolves.toEqual({ done: true, value: undefined })
    expect(() => stream.emit('close')).not.toThrow()
  })
})
