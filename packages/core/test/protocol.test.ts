import { describe, expect, it } from 'vitest';
import { decode, encode, PROTOCOL_VERSION, randomId } from '../src/protocol';

describe('消息格式', () => {
  it('编码后带版本号，能原样解出来', () => {
    const raw = encode({ t: 'text', id: 'abc', createdAt: 1, text: '你好' });
    const d = decode(raw);
    expect(d.ok).toBe(true);
    if (d.ok) expect(d.msg).toEqual({ v: PROTOCOL_VERSION, t: 'text', id: 'abc', createdAt: 1, text: '你好' });
  });

  it('看不懂的新消息不崩，并告诉我对方版本更新', () => {
    const d = decode(JSON.stringify({ v: PROTOCOL_VERSION + 1, t: 'video', id: 'x' }));
    expect(d).toEqual({ ok: false, reason: 'unknown-type', newer: true });
  });

  it('坏数据不崩', () => {
    expect(decode('{oops').ok).toBe(false);
    expect(decode('null').ok).toBe(false);
    expect(decode(JSON.stringify({ v: 1, t: 'text' })).ok).toBe(false);
    expect(decode(JSON.stringify({ v: 1, t: 'file-start', id: 'a', createdAt: 1, meta: { size: -1, mime: 'x' } })).ok).toBe(false);
  });

  it('随机编号长度对、不重复', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => randomId()));
    expect(ids.size).toBe(1000);
    expect([...ids][0]).toHaveLength(12);
  });
});
