import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import WebSocket from 'ws';
import { createRelay } from '../src/relay';

let server: Server, url = '';
beforeAll(async () => {
  const { wss } = createRelay({ maxMsgsPerSecond: 50 });
  server = createServer();
  server.on('upgrade', (req, s, h) => wss.handleUpgrade(req, s, h, (ws) => wss.emit('connection', ws, req)));
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://localhost:${(server.address() as AddressInfo).port}/signal`;
});
afterAll(() => server.close());

function client() {
  const ws = new WebSocket(url);
  const got: any[] = [];
  ws.on('message', (d) => got.push(JSON.parse(d.toString())));
  return { ws, got, ready: new Promise((r) => ws.on('open', r)) };
}
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('介绍人服务器', () => {
  it('同一个频道的人互相收到，别的频道收不到', async () => {
    const a = client(), b = client(), c = client();
    await Promise.all([a.ready, b.ready, c.ready]);
    a.ws.send(JSON.stringify({ sub: 'hutong/v1/aaaaaaaa' }));
    b.ws.send(JSON.stringify({ sub: 'hutong/v1/aaaaaaaa' }));
    c.ws.send(JSON.stringify({ sub: 'hutong/v1/cccccccc' }));
    await wait(50);
    a.ws.send(JSON.stringify({ pub: 'hutong/v1/aaaaaaaa', data: 'sealed-1' }));
    await wait(50);
    expect(b.got.filter((m) => m.data)).toEqual([{ topic: 'hutong/v1/aaaaaaaa', data: 'sealed-1' }]);
    expect(c.got.filter((m) => m.data)).toEqual([]);
    [a, b, c].forEach((x) => x.ws.close());
  });

  it('乱发的、频道名不对的，直接忽略不崩', async () => {
    const a = client();
    await a.ready;
    a.ws.send('not json');
    a.ws.send(JSON.stringify({ sub: 'x' }));
    a.ws.send(JSON.stringify({ pub: '../../etc', data: 1 }));
    await wait(50);
    expect(a.got).toEqual([]);
    a.ws.close();
  });
});
