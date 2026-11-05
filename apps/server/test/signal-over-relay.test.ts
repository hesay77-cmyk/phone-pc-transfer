// 换成自己的服务器后，加密的介绍信照样能送到（不用改别的代码）
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { afterAll, beforeAll, expect, it } from 'vitest';
import { newSecret } from '../../../packages/core/src/pairing';
import { SecureSignal, WsBus, type SignalMsg } from '../../../packages/core/src/signal';
import { createRelay } from '../src/relay';

let server: Server, url = '';
beforeAll(async () => {
  const { wss } = createRelay();
  server = createServer();
  server.on('upgrade', (req, s, h) => wss.handleUpgrade(req, s, h, (ws) => wss.emit('connection', ws, req)));
  await new Promise<void>((r) => server.listen(0, r));
  url = `ws://localhost:${(server.address() as AddressInfo).port}/signal`;
});
afterAll(() => server.close());

it('电脑和手机通过自己的介绍人服务器交换介绍信', async () => {
  const secret = newSecret();
  const pc = new SecureSignal(new WsBus([url], 'hutong/v1/'), 'pc');
  const phone = new SecureSignal(new WsBus([url], 'hutong/v1/'), 'phone');
  const got: SignalMsg[] = [];
  pc.onMessage((m) => got.push(m));
  await pc.start(secret);
  await phone.start(secret);
  await phone.send({ type: 'hello', sid: 'abc' }); // 还没连上时先排队，连上后发出
  for (let i = 0; i < 50 && got.length === 0; i++) await new Promise((r) => setTimeout(r, 20));
  expect(got).toEqual([{ type: 'hello', sid: 'abc' }]);
  pc.close(); phone.close();
});
