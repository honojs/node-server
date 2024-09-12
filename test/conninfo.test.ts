import { Hono } from 'hono'
import type { AddressType, ConnInfo } from 'hono/conninfo'
import type { AddressInfo } from 'net'
import { getConnInfo } from '../src/conninfo'

describe('ConnInfo', () => {
  it('Should works', async () => {
    const app = new Hono().get('/', (c) => c.json(getConnInfo(c)))

    const address: AddressInfo = {
      address: '0.0.0.0',
      family: 'IPv4',
      port: 3030,
    }
    expect(
      await (
        await app.request(
          '/',
          {},
          {
            incoming: {
              socket: {
                address: () => address,
              },
            },
          }
        )
      ).json()
    ).toEqual({
      remote: {
        address: address.address,
        addressType: address.family as AddressType,
        port: address.port,
      },
    } satisfies ConnInfo)
  })
})
