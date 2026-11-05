// 待发队列存到本机：网页被关掉、Chrome 重启之后，没送到的还在，连上后接着送。
// 短文字存在 KV 里；图片/文件本身、很长的文字存在单独的小数据库里（KV 只有几 MB，存不下会整个丢掉）。

import type { BlobStore } from './blobstore';
import type { KV } from './store';
import type { OutItem } from './transfer';

export interface OutboxStore {
  load(): Promise<OutItem[]>;
  save(items: OutItem[]): void;
}

type Saved =
  | Omit<Extract<OutItem, { kind: 'file' }>, 'blob'>
  | Extract<OutItem, { kind: 'text' }>
  | { id: string; kind: 'text'; createdAt: number; big: true };

/** 文字超过这么多字，放进小数据库，不放 KV */
const BIG_TEXT_CHARS = 20000;

export function persistentOutbox(kv: KV, blobs?: BlobStore, key = 'outbox'): OutboxStore {
  const stored = new Set<string>();
  const isBig = (i: OutItem) => !!blobs && i.kind === 'text' && i.text.length > BIG_TEXT_CHARS;
  return {
    async load() {
      let raw: Saved[] = [];
      try { raw = JSON.parse(kv.get(key) || '[]'); } catch { raw = []; }
      const items: OutItem[] = [];
      for (const r of raw) {
        if (r.kind === 'text' && !('big' in r)) { items.push(r); continue; }
        const blob = await blobs?.get(r.id).catch(() => undefined);
        if (!blob) continue;
        stored.add(r.id);
        if (r.kind === 'text') items.push({ id: r.id, kind: 'text', createdAt: r.createdAt, text: await blob.text() });
        else items.push({ ...r, blob });
      }
      return items;
    },
    save(items) {
      const saved: Saved[] = items.map((i) => i.kind === 'file' ? { id: i.id, kind: i.kind, createdAt: i.createdAt, meta: i.meta }
        : isBig(i) ? { id: i.id, kind: 'text', createdAt: i.createdAt, big: true } : i);
      kv.set(key, JSON.stringify(saved));
      if (!blobs) return;
      const inDb = items.filter((i) => i.kind === 'file' || isBig(i));
      void (async () => {
        try {
          for (const i of inDb) {
            if (stored.has(i.id)) continue;
            await blobs.put(i.id, i.kind === 'file' ? i.blob : new Blob([i.text], { type: 'text/plain;charset=utf-8' }));
            stored.add(i.id);
          }
          await blobs.prune(inDb.map((i) => i.id));
          for (const id of [...stored]) if (!inDb.some((i) => i.id === id)) stored.delete(id);
        } catch { /* 存不下也不影响这次发送 */ }
      })();
    }
  };
}
