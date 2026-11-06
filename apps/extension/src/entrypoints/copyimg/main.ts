// 点照片通知后弹出的小窗口：把照片放进剪贴板，成功就自己关掉。
import { browser } from 'wxt/browser';
import { getFile, toPng } from '../../lib/files';
import { lang, t } from '../../lib/i18n';
import type { ToEngine } from '../../lib/types';

const id = new URLSearchParams(location.search).get('id') || '';
const $ = (x: string) => document.getElementById(x)!;
document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
document.title = t.copyPhotoTitle;
$('msg').textContent = t.copyingPhoto;
$('btn').textContent = t.clickToCopy;
const say = (cls: 'ok' | 'bad', text: string) => { const el = document.createElement('span'); el.className = cls; el.textContent = text; $('msg').replaceChildren(el); };
const log = (text: string) => browser.runtime.sendMessage({ to: 'engine', type: 'log', text } satisfies ToEngine).catch(() => {});

async function copy(byClick: boolean) {
  const blob = await getFile(id);
  if (!blob) throw new Error(t.photoGoneCopy);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPng(blob) })]);
  say('ok', t.copiedGo);
  $('btn').hidden = true;
  void log((byClick ? '在小窗口点按钮' : '点通知后') + '复制照片成功');
  setTimeout(() => window.close(), byClick ? 600 : 900);
}

window.addEventListener('load', () => {
  setTimeout(() => copy(false).catch((e: Error) => {
    say('bad', t.autoCopyFailed);
    $('btn').hidden = false;
    void log('点通知后自动复制照片失败：' + e.message);
  }), 150);
});
$('btn').onclick = () => copy(true).catch((e: Error) => {
  say('bad', t.stillCantCopy(e.message));
});
