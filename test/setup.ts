Object.defineProperty(global, 'fetch', {
  value: global.fetch,
  writable: true,
})
Object.defineProperty(global, 'Response', {
  value: global.Response,
  writable: true,
})
Object.defineProperty(global, 'Request', {
  value: global.Request,
  writable: true,
})
