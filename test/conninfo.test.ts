import { Hono } from 'hono'
import type { AddressType, ConnInfo } from 'hono/conninfo'
import { getConnInfo } from '../src/conninfo'

describe('ConnInfo', () => {
  it('Should works', async () => {
    const app = new Hono().get('/', (c) => c.json(getConnInfo(c)))

    const socket = {
      remoteAddress: '0.0.0.0',
      remoteFamily: 'IPv4',
      remotePort: 3030,
    }
    expect(
      await (
        await app.request(
          '/',
          {},
          {
            incoming: {
              socket,
            },
          }
        )
      ).json()
    ).toEqual({
      remote: {
        address: socket.remoteAddress,
        addressType: socket.remoteFamily as AddressType,
        port: socket.remotePort,
      },
    } satisfies ConnInfo)
  })
})
