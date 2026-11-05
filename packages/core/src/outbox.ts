// 待发队列存到本机：网页被关掉、Chrome 重启之后，没送到的还在，连上后接着送。
// 文字存在 KV 里；图片/文件本身存在单独的小数据库里（和收到的照片分开，免得被清理掉）。

import type { BlobStore } from './blobstore';
import type { KV } from './store';
import type { OutItem } from './transfer';

export interface OutboxStore {
  load(): Promise<OutItem[]>;
  save(items: OutItem[]): void;
}

type Saved = Omit<Extract<OutItem, { kind: 'file' }>, 'blob'> | Extract<OutItem, { kind: 'text' }>;

export function persistentOutbox(kv: KV, blobs?: BlobStore, key = 'outbox'): OutboxStore {
  const stored = new Set<string>();
  return {
    async load() {
      let raw: Saved[] = [];
      try { raw = JSON.parse(kv.get(key) || '[]'); } catch { raw = []; }
      const items: OutItem[] = [];
      for (const r of raw) {
        if (r.kind === 'text') { items.push(r); continue; }
        const blob = await blobs?.get(r.id).catch(() => undefined);
        if (blob) { items.push({ ...r, blob }); stored.add(r.id); }
      }
      return items;
    },
    save(items) {
      const saved: Saved[] = items.map((i) => (i.kind === 'file' ? { id: i.id, kind: i.kind, createdAt: i.createdAt, meta: i.meta } : i));
      kv.set(key, JSON.stringify(saved));
      if (!blobs) return;
      const files = items.filter((i): i is Extract<OutItem, { kind: 'file' }> => i.kind === 'file');
      void (async () => {
        try {
          for (const f of files) if (!stored.has(f.id)) { await blobs.put(f.id, f.blob); stored.add(f.id); }
          await blobs.prune(files.map((f) => f.id));
          for (const id of [...stored]) if (!files.some((f) => f.id === id)) stored.delete(id);
        } catch { /* 存不下也不影响这次发送 */ }
      })();
    }
  };
}
