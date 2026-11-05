// 一个最简单的「存东西」接口：浏览器里用 localStorage，测试里用内存。

export interface KV {
  get(key: string): string | null;
  set(key: string, value: string): void;
  remove(key: string): void;
}

export function localKV(prefix = 'hutong:'): KV {
  return {
    get: (k) => { try { return localStorage.getItem(prefix + k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(prefix + k, v); } catch { /* 存不了就算了 */ } },
    remove: (k) => { try { localStorage.removeItem(prefix + k); } catch { /* 同上 */ } }
  };
}

export function memoryKV(): KV {
  const m = new Map<string, string>();
  return { get: (k) => m.get(k) ?? null, set: (k, v) => void m.set(k, v), remove: (k) => void m.delete(k) };
}

/** 记住收到过的消息编号，对方重发时不重复处理 */
export class SeenIds {
  private ids: string[];
  private set: Set<string>;
  constructor(private kv: KV, private key = 'seen', private max = 500) {
    try { this.ids = JSON.parse(kv.get(key) || '[]'); } catch { this.ids = []; }
    this.set = new Set(this.ids);
  }
  has(id: string) { return this.set.has(id); }
  add(id: string) {
    if (this.set.has(id)) return;
    this.ids.push(id);
    this.set.add(id);
    if (this.ids.length > this.max) this.set.delete(this.ids.shift()!);
    this.kv.set(this.key, JSON.stringify(this.ids));
  }
}
