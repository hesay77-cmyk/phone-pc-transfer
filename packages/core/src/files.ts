// 文件的小工具：两端对「这是能直接显示的图片，还是普通文件」要有同样的判断。

/** 浏览器能直接显示的图片（苹果的 HEIC 电脑上的 Chrome 显示不了，当普通文件存） */
export function isShowableImage(mime: string): boolean {
  return /^image\/(jpeg|png|gif|webp|avif|bmp|svg\+xml)$/.test(mime);
}

/** 文件名里 Windows 不允许的字符换掉；太长的截短（保留扩展名） */
export function safeFileName(name: string, fallback = '文件'): string {
  let n = (name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^[\s.]+|[\s.]+$/g, '');
  if (!n) n = fallback;
  if (n.length > 120) {
    const dot = n.lastIndexOf('.');
    const ext = dot > 0 && n.length - dot <= 10 ? n.slice(dot) : '';
    n = n.slice(0, 120 - ext.length) + ext;
  }
  return n;
}

/** 只有英文和数字的备用文件名（个别系统不认中文文件名时用） */
export function asciiFileName(name: string, prefix = 'file'): string {
  const dot = name.lastIndexOf('.');
  const ext = dot > 0 ? name.slice(dot).replace(/[^A-Za-z0-9.]/g, '').slice(0, 10) : '';
  const d = new Date();
  const p = (x: number) => String(x).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}${ext}`;
}

export function sizeText(n: number): string {
  return n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(n / 1024)) + ' KB';
}
