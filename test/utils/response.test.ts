import { Hono } from 'hono'
import request from 'supertest'
import type { HttpBindings } from '../../src/'
import { createAdaptorServer } from '../../src/server'
import { RESPONSE_ALREADY_SENT } from '../../src/utils/response'

describe('RESPONSE_ALREADY_SENT', () => {
  const app = new Hono<{ Bindings: HttpBindings }>()
  app.get('/', (c) => {
    const { outgoing } = c.env
    outgoing.writeHead(200, { 'Content-Type': 'text/plain' })
    outgoing.end('Hono!')
    return RESPONSE_ALREADY_SENT
  })
  const server = createAdaptorServer(app)

  it('Should return 200 response - GET /', async () => {
    const res = await request(server).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch('text/plain')
    expect(res.text).toBe('Hono!')
  })
})
