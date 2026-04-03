import Fastify from 'fastify'

const app = Fastify()
const port = 3000

app.get('/', async (_req, reply) => {
  return reply.send('Hi')
})

app.get('/id/:id', async (req, reply) => {
  const { id } = req.params
  const name = req.query.name
  return reply
    .header('x-powered-by', 'benchmark')
    .send(`${id} ${name}`)
})

app.post('/json', async (req, reply) => {
  return reply.send(req.body)
})

app.listen({ port, host: '127.0.0.1' }, () => {
  console.log(`Listening on http://localhost:${port}`)
})
