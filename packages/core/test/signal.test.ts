import { describe, expect, it } from 'vitest';
import { deriveKeys, newSecret, seal } from '../src/pairing';
import { SecureSignal, type BusStatus, type SignalBus, type SignalMsg } from '../src/signal';

/** 内存里的「介绍人」：同一频道的人互相能收到（包括自己发的，和真 MQTT 一样） */
class Hub {
  subs = new Map<string, Array<(p: string) => void>>();
  sent: Array<{ topic: string; payload: string }> = [];
  bus(): SignalBus {
    let topic = '';
    return {
      start: (t, cb) => { topic = t; this.subs.set(t, [...(this.subs.get(t) ?? []), cb]); },
      publish: (p) => { this.sent.push({ topic, payload: p }); (this.subs.get(topic) ?? []).forEach((cb) => cb(p)); },
      onStatus: (_cb: (s: BusStatus, d: string) => void) => {},
      close: () => {}
    };
  }
}
const tick = () => new Promise((r) => setTimeout(r, 20));

describe('加密的介绍信', () => {
  it('同一个暗号的电脑和手机能互相收到，自己发的自己不收', async () => {
    const hub = new Hub(), s = newSecret();
    const pc = new SecureSignal(hub.bus(), 'pc'), phone = new SecureSignal(hub.bus(), 'phone');
    const gotPc: SignalMsg[] = [], gotPhone: SignalMsg[] = [];
    pc.onMessage((m) => gotPc.push(m));
    phone.onMessage((m) => gotPhone.push(m));
    await pc.start(s); await phone.start(s);
    await phone.send({ type: 'hello', sid: 's1' });
    await pc.send({ type: 'offer', sid: 's1', sdp: 'x' });
    await tick();
    expect(gotPc).toEqual([{ type: 'hello', sid: 's1' }]);
    expect(gotPhone).toEqual([{ type: 'offer', sid: 's1', sdp: 'x' }]);
  });

  it('介绍人看到的只有乱码，看不到连接信息', async () => {
    const hub = new Hub(), s = newSecret();
    const phone = new SecureSignal(hub.bus(), 'phone');
    await phone.start(s);
    await phone.send({ type: 'answer', sid: 's1', sdp: 'candidate 192.168.1.5' });
    expect(hub.sent[0]!.payload).not.toContain('192.168');
    expect(hub.sent[0]!.topic).not.toContain(s);
  });

  it('同一封信重放一次只算一次；太旧的信丢掉；别的暗号写的信丢掉', async () => {
    const hub = new Hub(), s = newSecret();
    const pc = new SecureSignal(hub.bus(), 'pc');
    const got: SignalMsg[] = [];
    pc.onMessage((m) => got.push(m));
    await pc.start(s);
    const { key } = await deriveKeys(s);
    const fresh = await seal(key, { from: 'phone', ts: Date.now(), n: 'n1', m: { type: 'hello', sid: 'a' } });
    await pc.receive(fresh); await pc.receive(fresh);
    const old = await seal(key, { from: 'phone', ts: Date.now() - 60 * 60 * 1000, n: 'n2', m: { type: 'hello', sid: 'b' } });
    await pc.receive(old);
    const other = await deriveKeys(newSecret());
    await pc.receive(await seal(other.key, { from: 'phone', ts: Date.now(), n: 'n3', m: { type: 'hello', sid: 'c' } }));
    expect(got).toEqual([{ type: 'hello', sid: 'a' }]);
  });
});
