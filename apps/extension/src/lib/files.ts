// 收到的照片存在插件自己的小数据库里（引擎、侧边栏、复制小窗口都能读），只留最近 30 张。

const DB = 'hutong';
const STORE = 'files';
const KEEP = 30;

function db(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const r = indexedDB.open(DB, 1);
    r.onupgradeneeded = () => r.result.createObjectStore(STORE);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return db().then((d) => new Promise<T>((res, rej) => {
    const t = d.transaction(STORE, mode);
    const req = fn(t.objectStore(STORE));
    t.oncomplete = () => { res(req.result); d.close(); };
    t.onerror = () => { rej(t.error); d.close(); };
  }));
}

export const putFile = (id: string, blob: Blob) => tx('readwrite', (s) => s.put(blob, id));
export const getFile = (id: string) => tx<Blob | undefined>('readonly', (s) => s.get(id));

/** 只留 keepIds 里的（最近的那些） */
export async function pruneFiles(keepIds: string[]) {
  const keys = (await tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) as string[];
  const keep = new Set(keepIds.slice(0, KEEP));
  await Promise.all(keys.filter((k) => !keep.has(k)).map((k) => tx('readwrite', (s) => s.delete(k))));
}

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
  return ascii ? `phone-photo-${day}-${time}.${ext}` : `手机照片 ${day} ${time}.${ext}`;
}
