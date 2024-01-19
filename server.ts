import type { IncomingMessage } from 'http'
import type { Socket } from 'net'
import { Hono } from 'hono'
import { WebSocketServer } from 'ws'
import { serve } from './src'

class UpgradeResponse extends Response {
    status = 101
    
    constructor(body?: BodyInit | null, init?: ResponseInit) {
        super(body, init)
    }
}

const app = new Hono<{
    Bindings: {
        incoming: IncomingMessage;
        socket: Socket;
        head: Buffer;
    }
}>()
const wsServer = new WebSocketServer({ noServer: true })

app.get('/', (c) => {
    console.log(c.env)
    
    wsServer.handleUpgrade(c.env.incoming, c.env.socket, c.env.head, (ws) => {
        ws.send('Hello World!')
    })
    
    return new UpgradeResponse()
})


serve(app)