# Node.js Adapter for Hono

This adapter allows you to run your Hono application on Node.js. Initially, Hono wasn't designed for Node.js, but with this adapter, it can now be used with Node.js. It utilizes web standard APIs implemented in Node.js version 18 or higher.

While Hono is ultra-fast, it may not be as fast on Node.js due to the overhead involved in adapting Hono's API to Node.js.

However, it's worth noting that it is still faster than Express.

## Requirement

It works on Node.js versions greater than 18.x. The specific required Node.js versions are as follows:

- 18.x => 18.14.1+
- 19.x => 19.7.0+
- 20.x => 20.0.0+

Essentially, you can simply use the latest version of each major release.

## Install

You can install from npm registry with `npm` command:

```
npm install @hono/node-server
```

Or use `yarn`:

```
yarn add @hono/node-server
```

## Usage

Just import `@hono/node-server` at the top and write the code as usual.
The same code that runs on Cloudflare Workers, Deno, and Bun will work.

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hono meets Node.js'))

serve(app, (info) => {
  console.log(`Listening on http://localhost:${info.port}`) // Listening on http://localhost:3000
})
```

For example, run it using `ts-node`. Then an HTTP server will be launched. The default port is `3000`.

```
ts-node ./index.ts
```

Open `http://localhost:3000` with your browser.

## Options

### `port`

```ts
serve({
  fetch: app.fetch,
  port: 8787, // Port number, default is 3000
})
```

### `createServer`

```ts
import { createServer } from 'node:https'
import fs from 'node:fs'

//...

serve({
  fetch: app.fetch,
  createServer: createServer,
  serverOptions: {
    key: fs.readFileSync('test/fixtures/keys/agent1-key.pem'),
    cert: fs.readFileSync('test/fixtures/keys/agent1-cert.pem'),
  },
})
```

## Middleware

Most built-in middleware also works with Node.js.
Read [the documentation](https://hono.dev/middleware/builtin/basic-auth) and use the Middleware of your liking.

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { prettyJSON } from 'hono/pretty-json'

const app = new Hono()

app.get('*', prettyJSON())
app.get('/', (c) => c.json({ 'Hono meets': 'Node.js' }))

serve(app)
```

## Serve Static Middleware

Use Serve Static Middleware that has been created for Node.js.

```ts
import { serveStatic } from '@hono/node-server/serve-static'

//...

app.use('/static/*', serveStatic({ root: './' }))
```

Note that `root` must be _relative_ to the current working directory - absolute paths are not supported.

### Options

#### `rewriteRequestPath`

If you want to serve files in `./.foojs` with the request path `/__foo/*`, you can write like the following.

```ts
app.use(
  '/__foo/*',
  serveStatic({
    root: './.foojs/',
    rewriteRequestPath: (path: string) => path.replace(/^\/__foo/, ''),
  })
)
```

## Related projects

- Hono - <https://hono.dev>
- Hono GitHub repository - <https://github.com/honojs/hono>

## Author

Yusuke Wada <https://github.com/yusukebe>

## License

MIT
