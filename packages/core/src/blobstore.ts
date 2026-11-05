// 在浏览器里存照片（IndexedDB）。插件和手机网页共用，只留最近若干张。

export class BlobStore {
  constructor(private dbName = 'hutong', private store = 'files', private keep = 30) {}

  private db(): Promise<IDBDatabase> {
    return new Promise((res, rej) => {
      const r = indexedDB.open(this.dbName, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(this.store);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  private async tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const d = await this.db();
    return new Promise<T>((res, rej) => {
      const t = d.transaction(this.store, mode);
      const req = fn(t.objectStore(this.store));
      t.oncomplete = () => { res(req.result); d.close(); };
      t.onerror = () => { rej(t.error); d.close(); };
    });
  }

  put(id: string, blob: Blob) { return this.tx('readwrite', (s) => s.put(blob, id)); }
  get(id: string) { return this.tx<Blob | undefined>('readonly', (s) => s.get(id)); }
  delete(id: string) { return this.tx('readwrite', (s) => s.delete(id)); }

  /** 只留 recentIds 里最前面的 keep 个 */
  async prune(recentIds: string[]) {
    const keys = (await this.tx<IDBValidKey[]>('readonly', (s) => s.getAllKeys())) as string[];
    const keep = new Set(recentIds.slice(0, this.keep));
    for (const k of keys) if (!keep.has(k)) await this.tx('readwrite', (s) => s.delete(k));
  }
}
