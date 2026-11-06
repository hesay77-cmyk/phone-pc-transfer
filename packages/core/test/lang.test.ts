import { describe, expect, it } from 'vitest';
import { pickLang } from '../src/lang';

describe('界面语言跟随系统', () => {
  it('中文系统显示中文（简体、繁体都算）', () => {
    for (const t of ['zh', 'zh-CN', 'zh-cn', 'zh-Hans-CN', 'zh-TW', 'zh-HK']) expect(pickLang(t)).toBe('zh');
  });
  it('其他语言都显示英文', () => {
    for (const t of ['en', 'en-US', 'ja', 'ko-KR', 'fr', 'de-DE', 'zu', '', undefined, null]) expect(pickLang(t)).toBe('en');
  });
});

import { localDeviceName } from '../src/lang';
describe('对方的设备名换成这边的语言', () => {
  it('认得的换掉，认不出的原样', () => {
    expect(localDeviceName('Windows 电脑', 'en')).toBe('Windows PC');
    expect(localDeviceName('Windows PC', 'zh')).toBe('Windows 电脑');
    expect(localDeviceName('电脑', 'en')).toBe('');
    expect(localDeviceName('Android phone', 'zh')).toBe('安卓手机');
    expect(localDeviceName('iPhone', 'zh')).toBe('iPhone');
    expect(localDeviceName(undefined, 'en')).toBe('');
  });
});
