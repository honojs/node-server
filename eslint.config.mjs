import baseConfig from '@hono/eslint-config'

export default [
  ...baseConfig,
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            // Don't allow imports from 'ws` in src to prevent leaking ws types into the public API
            {
              name: 'ws',
              message:
                'Import websocket types from src/websocket-types.ts instead of from `ws`, see src/websocket-types.ts and https://github.com/honojs/node-server/issues/353 for more details.',
            },
          ],
        },
      ],
    },
  },
]
