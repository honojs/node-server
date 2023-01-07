# Hono on Node.js

**`@honojs/node-server` is renamed to `@hono/node-serer` !!**

---

This is **HTTP Server for Hono on Node.js**.
Hono is ultrafast web framework for Cloudflare Workers, Deno, and Bun.
**It's not for Node.js**.
**BUT**, there may be a case that you really want to run on Node.js. This library is an adapter server that connects Hono and Node.js.

Hono is ultra fast, but not so fast on Node.js, because there is an overhead to adapt Hono's API to Node.js.

By the way, it is 2.x times faster than Express.

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

serve(app)
```

For example, run it using `ts-node`. Then an HTTP server will be launched. The default port is `3000`.

```
ts-node ./index.ts
```

Open `http://localhost:3000` with your browser.

## Options

```ts
serve({
  fetch: app.fetch,
  port: 8787, // Port number, default is 3000
})
```

## Middleware

Most built-in middleware also works with Node.js.
Read [the documentation](https://honojs.dev/docs/builtin-middleware/) and use the Middleware of your liking.

```ts
import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { prettyJSON } from 'hono/pretty-json'

const app = new Hono()

app.get('*', prettyJSON())
app.get('/', (c) => c.json({ 'Hono meets': 'Node.js' }))

serve(app)
```

### Serve Static Middleware

Use Serve Static Middleware that has been created for Node.js.

```ts
import { serveStatic } from '@hono/node-server/serve-static'

//...

app.use('/static/*', serveStatic({ root: './' }))
```

## Related projects

- Hono - <https://honojs.dev>
- Hono GitHub repository - <https://github.com/honojs/hono>

## Author

Yusuke Wada <https://github.com/yusukebe>

## License

MIT
