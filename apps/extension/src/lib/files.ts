// 收到的照片存在插件自己的小数据库里（引擎、侧边栏、复制小窗口都能读），只留最近 30 张。
import { BlobStore } from '@hutong/core';
import { t } from './i18n';

const store = new BlobStore('hutong', 'files', 30);
export const putFile = (id: string, blob: Blob) => store.put(id, blob);
export const getFile = (id: string) => store.get(id);
export const deleteFile = (id: string) => store.delete(id);
export const pruneFiles = (recentIds: string[]) => store.prune(recentIds);

/** 剪贴板只收 PNG：别的格式先转一下 */
export async function toPng(blob: Blob): Promise<Blob> {
  if (blob.type === 'image/png') return blob;
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  cv.getContext('2d')!.drawImage(bmp, 0, 0);
  return cv.convertToBlob({ type: 'image/png' });
}

/** 通知里用的小缩略图 */
export async function thumbnail(blob: Blob, max = 360): Promise<string | undefined> {
  try {
    const bmp = await createImageBitmap(blob);
    const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
    const cv = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    cv.getContext('2d')!.drawImage(bmp, 0, 0, cv.width, cv.height);
    const b = await cv.convertToBlob({ type: 'image/jpeg', quality: 0.8 });
    return await new Promise<string>((res) => { const r = new FileReader(); r.onload = () => res(r.result as string); r.readAsDataURL(b); });
  } catch {
    return undefined;
  }
}

export function photoName(mime: string, ascii = false, d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const ext = ({ 'image/png': 'png', 'image/heic': 'heic', 'image/gif': 'gif', 'image/webp': 'webp' } as Record<string, string>)[mime] || 'jpg';
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  const time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return ascii ? `phone-photo-${day}-${time}.${ext}` : `${t.phonePhoto} ${day} ${time}.${ext}`;
}
