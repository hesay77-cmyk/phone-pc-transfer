// 点图片通知后弹出的小窗口：把图片放进剪贴板，成功就自己关掉。
// 后台页面没有焦点，Chrome 不让往剪贴板放图片；新开的窗口有焦点，所以在这里复制。
const id = new URLSearchParams(location.search).get('id');
const $ = (x) => document.getElementById(x);
const report = (ok, detail) =>
  chrome.runtime.sendMessage({ to: 'offscreen', type: 'result', key: 'notifCopy', ok, detail }).catch(() => {});

async function pngBlob() {
  const it = await chrome.runtime.sendMessage({ to: 'offscreen', type: 'get-image', id });
  if (!it) throw new Error('找不到这张图（可能被新的挤掉了）');
  const blob = await (await fetch(it.dataUrl)).blob();
  if (blob.type === 'image/png') return blob;
  // 剪贴板只收 PNG，JPG 先转一下
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  cv.getContext('2d').drawImage(bmp, 0, 0);
  return cv.convertToBlob({ type: 'image/png' });
}

async function copy(byClick) {
  const t0 = performance.now();
  const png = await pngBlob();
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
  const ms = Math.round(performance.now() - t0);
  $('msg').innerHTML = '<span class="ok">已复制，去按 Ctrl+V 吧</span>';
  $('btn').hidden = true;
  report(true, (byClick ? '点小窗口里的按钮' : '点通知后自动') + '复制成功，用时 ' + ms + ' 毫秒');
  setTimeout(() => window.close(), byClick ? 600 : 900);
}

window.addEventListener('load', () => {
  // 等窗口真正拿到焦点再复制
  setTimeout(() => {
    copy(false).catch((e) => {
      $('msg').innerHTML = '<span class="bad">自动复制没成功</span>';
      $('btn').hidden = false;
      report(false, '点通知后自动复制失败：' + e.message + '（小窗口里有按钮可以再点）');
    });
  }, 150);
});
$('btn').onclick = () => copy(true).catch((e) => {
  $('msg').innerHTML = '<span class="bad">还是复制不了：' + e.message + '</span>';
  report(false, '点小窗口按钮也复制失败：' + e.message);
});
