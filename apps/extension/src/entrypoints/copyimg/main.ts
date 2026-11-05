// 点照片通知后弹出的小窗口：把照片放进剪贴板，成功就自己关掉。
import { browser } from 'wxt/browser';
import { getFile, toPng } from '../../lib/files';
import type { ToEngine } from '../../lib/types';

const id = new URLSearchParams(location.search).get('id') || '';
const $ = (x: string) => document.getElementById(x)!;
const log = (text: string) => browser.runtime.sendMessage({ to: 'engine', type: 'log', text } satisfies ToEngine).catch(() => {});

async function copy(byClick: boolean) {
  const blob = await getFile(id);
  if (!blob) throw new Error('找不到这张照片了（只保留最近 30 张）');
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPng(blob) })]);
  $('msg').innerHTML = '<span class="ok">已复制，去按 Ctrl+V 吧</span>';
  $('btn').hidden = true;
  void log((byClick ? '在小窗口点按钮' : '点通知后') + '复制照片成功');
  setTimeout(() => window.close(), byClick ? 600 : 900);
}

window.addEventListener('load', () => {
  setTimeout(() => copy(false).catch((e: Error) => {
    $('msg').innerHTML = '<span class="bad">没能自动复制</span>';
    $('btn').hidden = false;
    void log('点通知后自动复制照片失败：' + e.message);
  }), 150);
});
$('btn').onclick = () => copy(true).catch((e: Error) => {
  $('msg').innerHTML = '<span class="bad">还是复制不了：' + e.message + '</span>';
});
