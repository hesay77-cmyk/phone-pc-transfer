import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { waitIce } from '../src/link';

/** 只模拟 waitIce 用到的那一点 RTCPeerConnection */
function fakePc() {
  const t = new EventTarget() as EventTarget & { iceGatheringState: string; emit(c: string | null): void; complete(): void };
  t.iceGatheringState = 'gathering';
  t.emit = (c) => {
    const e = new Event('icecandidate') as any;
    e.candidate = c === null ? null : { candidate: c };
    t.dispatchEvent(e);
  };
  t.complete = () => { t.iceGatheringState = 'complete'; t.dispatchEvent(new Event('icegatheringstatechange')); };
  return t;
}
const HOST = 'candidate:1 1 udp 2122260223 abc.local 54321 typ host generation 0';
const SRFLX = 'candidate:2 1 udp 1686052607 203.0.113.5 40000 typ srflx raddr 0.0.0.0 rport 0 generation 0';

async function finishedAt(pc: ReturnType<typeof fakePc>, p: Promise<void>, script: [number, () => void][]) {
  const start = Date.now();
  let at = -1;
  void p.then(() => { at = Date.now() - start; });
  const events = [...script].sort((a, b) => a[0] - b[0]);
  let t = 0;
  for (const [when, fn] of events) {
    await vi.advanceTimersByTimeAsync(when - t);
    t = when;
    if (at < 0) fn();
  }
  await vi.advanceTimersByTimeAsync(3000);
  return at;
}

describe('waitIce：等连接地址', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('没配 STUN：拿到本机地址 300 毫秒就走', async () => {
    const pc = fakePc();
    const at = await finishedAt(pc, waitIce(pc as any, 2500), [[0, () => pc.emit(HOST)]]);
    expect(at).toBe(300);
  });

  it('配了 STUN、外网地址很快就到：不多等', async () => {
    const pc = fakePc();
    const at = await finishedAt(pc, waitIce(pc as any, 2500, true), [[0, () => pc.emit(HOST)], [100, () => pc.emit(SRFLX)]]);
    expect(at).toBe(300);
  });

  it('外网地址晚到：到了再等 50 毫秒就走', async () => {
    const pc = fakePc();
    const at = await finishedAt(pc, waitIce(pc as any, 2500, true), [[0, () => pc.emit(HOST)], [600, () => pc.emit(SRFLX)]]);
    expect(at).toBe(650);
  });

  it('STUN 连不上：最多多等到 1 秒，不会卡住', async () => {
    const pc = fakePc();
    const at = await finishedAt(pc, waitIce(pc as any, 2500, true), [[0, () => pc.emit(HOST)]]);
    expect(at).toBe(1000);
  });

  it('收集完了马上走', async () => {
    const pc = fakePc();
    const at = await finishedAt(pc, waitIce(pc as any, 2500, true), [[0, () => pc.emit(HOST)], [40, () => pc.complete()]]);
    expect(at).toBe(40);
    const pc2 = fakePc();
    const at2 = await finishedAt(pc2, waitIce(pc2 as any, 2500, true), [[0, () => pc2.emit(HOST)], [40, () => pc2.emit(null)]]);
    expect(at2).toBe(40);
  });

  it('什么地址都没有：最多等 maxMs', async () => {
    const pc = fakePc();
    const at = await finishedAt(pc, waitIce(pc as any, 2500, true), []);
    expect(at).toBe(2500);
  });
});
