import { describe, expect, it } from 'vitest';
import { looksLikePassword, trimForHistory } from '../src/text';

describe('像不像密码', () => {
  it('密码管理器生成的那种算', () => {
    for (const p of ['Xk9#mP2$vL', 'aB3dE5fG7h', 'hunter2!Pass', 'q8W-zT4_rY1u']) expect(looksLikePassword(p)).toBe(true);
  });
  it('普通内容不算', () => {
    for (const t of ['384920', 'hello world', 'https://example.com/a?b=1', 'www.Example.com', 'someone@mail.com',
      'function hi() {}', '你好世界Hello123', 'short1A', 'ls -la /home', '这是一段中文', 'README.md']) {
      expect(looksLikePassword(t), t).toBe(false);
    }
  });
  it('太长的文字记录里只留开头', () => {
    expect(trimForHistory('a'.repeat(30000))).toEqual({ text: 'a'.repeat(20000), cut: true });
    expect(trimForHistory('短')).toEqual({ text: '短', cut: false });
  });
});
