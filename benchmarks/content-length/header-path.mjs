// Inspect the cache without materializing response.headers or changing the measured path.
export const headerPath = (response) => {
  const cache =
    response[Object.getOwnPropertySymbols(response).find((key) => key.description === 'cache')]
  if (!cache) return 'uncached'
  const headers = cache[2]
  if (!headers) return 'default'
  if (headers instanceof Headers) return 'Headers'
  if (Array.isArray(headers)) return 'tuples'
  return 'plain'
}
