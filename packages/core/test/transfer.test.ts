import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { decode, encode, type MsgBody } from '../src/protocol';
import { memoryKV } from '../src/store';
import { Transfer, type Incoming, type OutItem, type Pipe } from '../src/transfer';

/** 两头用内存连起来的假通道，可以手动断开、丢消息 */
class FakePipe implements Pipe {
  other!: FakePipe;
  target!: Transfer;
  open = true;
  drop = (_m: MsgBody | ArrayBuffer) => false;
  reconnects: string[] = [];
  get ready() { return this.open; }
  send(m: MsgBody) {
    if (!this.open) return false;
    if (this.drop(m)) return true;
    const d = decode(encode(m));
    queueMicrotask(() => { if (d.ok) this.target.handle(d.msg); });
    return true;
  }
  sendBinary(b: ArrayBuffer) {
    if (!this.open) return false;
    if (this.drop(b)) return true;
    queueMicrotask(() => this.target.handleBinary(b));
    return true;
  }
  async waitDrain() {}
  reconnect(why: string) { this.reconnects.push(why); }
}

function pair() {
  const pa = new FakePipe(), pb = new FakePipe();
  const delivered: Array<{ item: OutItem; info: any }> = [], received: Incoming[] = [];
  const a = new Transfer(pa, memoryKV(), { delivered: (item, info) => delivered.push({ item, info }) }, 1000);
  const b = new Transfer(pb, memoryKV(), { received: (i) => received.push(i) }, 1000);
  pa.other = pb; pb.other = pa; pa.target = b; pb.target = a;
  return { a, b, pa, pb, delivered, received };
}
const flush = () => new Promise((r) => setImmediate(r));

describe('发一条 / 收一条', () => {
  beforeEach(() => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] }));
  afterEach(() => vi.useRealTimers());

  it('文字发过去，对方确认后从待发队列里拿掉', async () => {
    const { a, delivered, received } = pair();
    a.sendText('echo 你好');
    await flush(); await flush();
    expect(received.map((r) => r.kind === 'text' && r.text)).toEqual(['echo 你好']);
    expect(delivered).toHaveLength(1);
    expect(a.pending).toHaveLength(0);
  });

  it('没连上时发的先存着，连上后自动发出去', async () => {
    const { a, pa, delivered, received } = pair();
    pa.open = false;
    a.sendText('断线时发的');
    await flush();
    expect(received).toHaveLength(0);
    expect(a.pending).toHaveLength(1);
    pa.open = true;
    a.linkUp();
    await flush(); await flush();
    expect(received).toHaveLength(1);
    expect(delivered[0]!.info).toEqual({ waitedForLink: true, resent: false });
  });

  it('对方没确认：8 秒后请通道重连，重连后补发；对方按编号去重只收一次', async () => {
    const { a, pa, pb, delivered, received } = pair();
    let dropAcks = true;
    pb.drop = (m) => dropAcks && !(m instanceof ArrayBuffer) && m.t === 'ack';
    a.sendText('确认丢了');
    await flush(); await flush();
    expect(received).toHaveLength(1);
    vi.advanceTimersByTime(8000);
    expect(pa.reconnects).toHaveLength(1);
    dropAcks = false;
    a.linkUp();
    await flush(); await flush();
    expect(received).toHaveLength(1);
    expect(delivered).toHaveLength(1);
    expect(delivered[0]!.info.resent).toBe(true);
  });

  it('图片分块发过去，拼回来一字节不差', async () => {
    const { a, received } = pair();
    const bytes = new Uint8Array(4500).map((_, i) => i % 251);
    a.sendFile(new Blob([bytes], { type: 'image/png' }), { name: 'x.png', w: 10, h: 20 });
    for (let i = 0; i < 20; i++) await flush();
    expect(received).toHaveLength(1);
    const r = received[0]!;
    expect(r.kind).toBe('file');
    if (r.kind === 'file') {
      expect(r.meta).toMatchObject({ name: 'x.png', size: 4500, mime: 'image/png', w: 10, h: 20 });
      expect(new Uint8Array(await r.blob.arrayBuffer())).toEqual(bytes);
    }
  });

  it('图片中途丢了一块：不确认、不交给界面，重连后整张重发', async () => {
    const { a, pa, received, delivered } = pair();
    let dropped = false;
    pa.drop = (m) => { if (m instanceof ArrayBuffer && !dropped) { dropped = true; return true; } return false; };
    a.sendFile(new Blob([new Uint8Array(3000)], { type: 'image/jpeg' }), { name: 'a.jpg' });
    for (let i = 0; i < 20; i++) await flush();
    expect(received).toHaveLength(0);
    vi.advanceTimersByTime(8000);
    expect(pa.reconnects).toHaveLength(1);
    a.linkUp();
    for (let i = 0; i < 20; i++) await flush();
    expect(received).toHaveLength(1);
    expect(delivered).toHaveLength(1);
  });
});
