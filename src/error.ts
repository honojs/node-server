/**
 * Error thrown when an incoming HTTP request cannot be parsed or validated.
 */
export class RequestError extends Error {
  constructor(
    message: string,
    options?: {
      cause?: unknown
    }
  ) {
    super(message, options)
    this.name = 'RequestError'
  }
}
