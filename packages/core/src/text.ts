// 和文字内容有关的小工具（插件和手机网页共用）。

/**
 * 看起来像密码：一整串英文字母数字符号（没有空格和中文）、8~64 个字符、有字母也有数字，大小写字母数字符号至少混了三种。
 * 「复制就发」碰到这种不自动发——从密码管理器里复制的密码不该悄悄跑到手机上。
 * 网址、纯数字验证码、普通单词和句子都不算。
 */
export function looksLikePassword(s: string): boolean {
  const t = s.trim();
  if (t.length < 8 || t.length > 64 || !/^[\x21-\x7e]+$/.test(t)) return false; // 只有英文字母、数字、符号，没有空格和中文
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t) || /^www\./i.test(t) || /^[\w.+-]+@[\w-]+\.[\w.-]+$/.test(t)) return false;
  const kinds = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/].filter((r) => r.test(t)).length;
  return kinds >= 3 && /\d/.test(t) && /[A-Za-z]/.test(t);
}

/** 记录里最多存这么多字（太长的只存开头，免得把本机存储撑满、整个记录都丢掉） */
export const HISTORY_MAX_CHARS = 20000;

export function trimForHistory(text: string): { text: string; cut: boolean } {
  return text.length > HISTORY_MAX_CHARS ? { text: text.slice(0, HISTORY_MAX_CHARS), cut: true } : { text, cut: false };
}
