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

import { asciiFileName, isShowableImage, safeFileName } from '../src/files';

describe('文件名和类型', () => {
  it('能显示的图片 / 普通文件', () => {
    expect(isShowableImage('image/jpeg')).toBe(true);
    expect(isShowableImage('image/heic')).toBe(false);
    expect(isShowableImage('application/pdf')).toBe(false);
  });
  it('Windows 不允许的字符换掉，保留扩展名', () => {
    expect(safeFileName('报告:2026/11?.docx')).toBe('报告_2026_11_.docx');
    expect(safeFileName('  ')).toBe('文件');
    const long = safeFileName('长'.repeat(200) + '.pdf');
    expect(long.length).toBe(120);
    expect(long.endsWith('.pdf')).toBe(true);
  });
  it('备用英文名', () => {
    expect(asciiFileName('报告.docx')).toMatch(/^file-\d{8}-\d{6}\.docx$/);
  });
});
