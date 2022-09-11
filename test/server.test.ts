import { createAdaptorServer } from '../src/server'
import request from 'supertest'
import { Hono } from 'hono'

describe('Server for running on Node.js', () => {
  const app = new Hono()
  app.get('/', (c) => c.text('Hello! Node!'))

  const server = createAdaptorServer({ fetch: app.fetch })

  it('Should return 200 response - GET /', async () => {
    const res = await request(server).get('/')
    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toMatch(/text\/plain/)
    expect(res.text).toBe('Hello! Node!')
  })
})
