import { Request, Response, Headers } from 'undici'

const mockTypes = {
  Request: Request,
  Response: Response,
  Headers: Headers,
}

export const mock = () => {
  Object.assign(globalThis, mockTypes)
}
