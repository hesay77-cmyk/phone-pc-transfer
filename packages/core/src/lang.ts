// 界面语言：跟随系统（2026-11-06 曦定）。中文系统（简体、繁体都算，繁体以后再单独做）显示中文，其他所有语言显示英文。

export type Lang = 'zh' | 'en';

export function pickLang(tag: string | undefined | null): Lang {
  return /^zh\b/i.test(tag ?? '') ? 'zh' : 'en';
}

/** 当前环境的语言（浏览器、插件后台、手机网页都能用） */
export function currentLang(): Lang {
  return pickLang(typeof navigator !== 'undefined' ? navigator.language : undefined);
}

/** 对方报上来的设备名是按对方的语言起的（「Windows 电脑」「Android phone」）：换成这边的语言；认不出的原样用，空 = 用默认叫法 */
const DEVICE_NAMES: Array<{ names: string[]; zh: string; en: string }> = [
  { names: ['Windows 电脑', 'Windows PC'], zh: 'Windows 电脑', en: 'Windows PC' },
  { names: ['电脑', 'your computer'], zh: '', en: '' },
  { names: ['安卓手机', 'Android phone'], zh: '安卓手机', en: 'Android phone' },
  { names: ['手机', 'Phone'], zh: '', en: '' }
];
export function localDeviceName(name: string | undefined, lang: Lang): string {
  const hit = DEVICE_NAMES.find((d) => d.names.includes(name ?? ''));
  return hit ? hit[lang] : (name ?? '');
}
