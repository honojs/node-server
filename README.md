# HTTP server for Hono on Node.js

**This project is still experimental.**

Hono is ultrafast web framework for Cloudflare Workers, Deno, and Bun.
**It's not for Node.js**.
**BUT**, there may be a case that you really want to run on Node.js. This library is an adaptor server that connects Hono and Node.js.

Hono is ultra fast, but not so fast on Node.js, because there is an overhead to adapt Hono's API to Node.js.

By the way, it is 2.x times faster than Express.

## Install

You can install from npm registry:

```
npm install @honojs/node-server
```

Or

```
yarn add @honojs/node-server
```

## Usage

The code:

```ts
import { serve } from '@honojs/node-server' // Write above `Hono`
import { Hono } from 'hono'

const app = new Hono()
app.get('/', (c) => c.text('Hono meets Node.js'))

serve(app)
```

And, run:

```
ts-node ./index.ts
```

## Options

```ts
serve({
  fetch: app.fetch,
  port: 8787,
})
```

## Related projects

- Hono - <https://honojs.dev>
- Hono GitHub repository - <https://github.com/honojs/hono>

## Author

Yusuke Wada <https://github.com/yusukebe>

## License

MIT
