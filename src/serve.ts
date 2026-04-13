import { realpathSync } from 'node:fs'
import { parseArgs } from 'node:util'
import { serve } from './server'

const { values, positionals } = parseArgs({
  options: {
    port: { type: 'string' },
  },
  allowPositionals: true,
})

if (positionals.length === 0) {
  throw new Error('Please specify the path to the app file.')
}

const appFilePath = realpathSync(positionals[0])
import(appFilePath).then(({ default: app }) => {
  serve(
    {
      fetch: app.fetch,
      port: values.port ? Number.parseInt(values.port) : undefined,
    },
    (info) => {
      console.log(`Listening on http://localhost:${info.port}`)
    }
  )
})
