import Fastify from 'fastify'

const app = Fastify()

app.get('/', async (_req, reply) => {
  return reply.send({ hello: 'world' })
})

app.listen({ port: 3000, host: '127.0.0.1' }, () => {
  console.log('Listening on http://localhost:3000')
})
