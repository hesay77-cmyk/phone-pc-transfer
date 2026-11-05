// 「发一条 / 收一条」这一层：上面的界面只管发和收，不管怎么送过去。
//   - 发：放进待发队列，没等到对方说「收到」就一直留着，连上后自动补发；
//   - 收：按编号去重，图片分块收齐后拼回原样。
// 现在只有「直连」一种送法（PeerLink）。以后加服务器中转，只要再实现一个 Pipe。

import { PROTOCOL_VERSION, randomId, type FileMeta, type Msg, type MsgBody } from './protocol';
import { SeenIds, type KV } from './store';
import type { OutboxStore } from './outbox';

/** 一条通道要提供的能力。PeerLink 已经满足；以后的「服务器中转」也照这个来。 */
export interface Pipe {
  readonly ready: boolean;
  send(m: MsgBody): boolean;
  sendBinary(b: ArrayBuffer): boolean;
  waitDrain(): Promise<void>;
  /** 发出去的东西对方迟迟不确认：请通道重连 */
  reconnect?(why: string): void;
}

export type OutItem =
  | { id: string; kind: 'text'; createdAt: number; text: string }
  | { id: string; kind: 'file'; createdAt: number; meta: FileMeta; blob: Blob };

export type Incoming =
  | { id: string; kind: 'text'; createdAt: number; text: string }
  | { id: string; kind: 'file'; createdAt: number; meta: FileMeta; blob: Blob; ms: number };

export interface TransferEvents {
  /** 对方确认收到了 */
  delivered?(item: OutItem, info: { waitedForLink: boolean; resent: boolean }): void;
  /** 收到对方发来的一条（已去重） */
  received?(item: Incoming): void;
  /** 发送进度 0~1 */
  progress?(item: OutItem, ratio: number): void;
  /** 待发队列有变化 */
  queue?(pending: number): void;
  log?(s: string): void;
}

interface Pending { item: OutItem; inflight: boolean; tries: number; waited: boolean; timer?: ReturnType<typeof setTimeout> }

const ACK_TIMEOUT_MS = 8000;

export class Transfer {
  private out: Pending[] = [];
  private flushing = false;
  private seen: SeenIds;
  private rx: { id: string; createdAt: number; meta: FileMeta; parts: ArrayBuffer[]; got: number; t0: number; skip: boolean } | null = null;

  constructor(private pipe: Pipe, kv: KV, private ev: TransferEvents = {}, private chunkSize = 16 * 1024, private store?: OutboxStore) {
    this.seen = new SeenIds(kv, 'seen-ids');
  }

  /** 把上次没送到的（存在本机的）放回待发队列 */
  async restore() {
    if (!this.store) return;
    const items = await this.store.load();
    const have = new Set(this.out.map((p) => p.item.id));
    for (const item of items) if (!have.has(item.id)) this.out.push({ item, inflight: false, tries: 0, waited: true });
    if (items.length) { this.log(`上次还有 ${items.length} 个没送到，连上后接着送`); this.ev.queue?.(this.out.length); void this.flush(); }
  }

  get pending(): OutItem[] { return this.out.map((p) => p.item); }

  sendText(text: string): OutItem {
    return this.enqueue({ id: randomId(), kind: 'text', createdAt: Date.now(), text });
  }

  sendFile(blob: Blob, meta: Omit<FileMeta, 'size' | 'mime'> & Partial<FileMeta>): OutItem {
    const full: FileMeta = { size: blob.size, mime: blob.type || 'application/octet-stream', ...meta };
    return this.enqueue({ id: randomId(), kind: 'file', createdAt: Date.now(), meta: full, blob });
  }

  /** 通道刚连上（或重连上）：之前没确认的全部重新发 */
  linkUp() {
    for (const p of this.out) { p.inflight = false; clearTimeout(p.timer); }
    // 注意：这里不清正在收的文件。新通道刚开，对方可能已经开始发了（比这边「连上了」的通知还早到），
    // 清掉就会把它丢了、对方白等 8 秒。旧通道收了一半的，对方重发时 file-start 会把它换掉。
    if (this.out.length) this.log('连上了，补发 ' + this.out.length + ' 个还没送到的');
    void this.flush();
  }

  /** 交给它处理通道上收到的消息；返回 true 表示是它管的 */
  handle(m: Msg): boolean {
    switch (m.t) {
      case 'ack': this.onAck(m.id); return true;
      case 'text':
        this.ack(m.id);
        if (this.seen.has(m.id)) { this.log('对方重发了一条已经收到的文字，忽略'); return true; }
        this.seen.add(m.id);
        this.ev.received?.({ id: m.id, kind: 'text', createdAt: m.createdAt, text: m.text });
        return true;
      case 'file-start':
        this.rx = { id: m.id, createdAt: m.createdAt, meta: m.meta, parts: [], got: 0, t0: Date.now(), skip: this.seen.has(m.id) };
        return true;
      case 'file-end': {
        const rx = this.rx;
        this.rx = null;
        if (!rx || rx.id !== m.id) return true; // 中途断过，等对方重发
        if (rx.skip) { this.ack(m.id); this.log('对方重发了一个已经收到的文件，忽略'); return true; }
        const blob = new Blob(rx.parts, { type: rx.meta.mime });
        if (blob.size !== rx.meta.size) { this.log(`文件不完整（${blob.size}/${rx.meta.size}），等对方重发`); return true; }
        this.ack(m.id);
        this.seen.add(m.id);
        this.ev.received?.({ id: m.id, kind: 'file', createdAt: rx.createdAt, meta: rx.meta, blob, ms: Date.now() - rx.t0 });
        return true;
      }
      default:
        return false;
    }
  }

  /** 交给它处理通道上收到的二进制块 */
  handleBinary(b: ArrayBuffer) {
    if (!this.rx || this.rx.skip) return;
    this.rx.parts.push(b);
    this.rx.got += b.byteLength;
  }

  /** 把待发的往外送。通道没准备好就等，准备好了再调一次。 */
  async flush() {
    if (this.flushing || !this.out.length) return;
    if (!this.pipe.ready) {
      for (const p of this.out) if (!p.inflight) p.waited = true;
      return;
    }
    this.flushing = true;
    try {
      for (const p of this.out.slice()) {
        if (p.inflight || !this.out.includes(p)) continue;
        if (!this.pipe.ready) break;
        p.inflight = true;
        const ok = p.item.kind === 'text'
          ? this.pipe.send({ t: 'text', id: p.item.id, createdAt: p.item.createdAt, text: p.item.text })
          : await this.sendFileNow(p.item);
        if (!ok) { p.inflight = false; break; }
        p.tries++;
        clearTimeout(p.timer);
        p.timer = setTimeout(() => {
          if (!this.out.includes(p)) return;
          p.inflight = false;
          this.log('对方 8 秒没确认收到，重新连接后再发');
          this.pipe.reconnect?.('对方没确认收到');
        }, ACK_TIMEOUT_MS);
      }
    } finally {
      this.flushing = false;
    }
  }

  // ---------------- 内部 ----------------

  private enqueue(item: OutItem): OutItem {
    this.out.push({ item, inflight: false, tries: 0, waited: false });
    this.persist();
    this.ev.queue?.(this.out.length);
    void this.flush();
    return item;
  }

  private onAck(id: string) {
    const i = this.out.findIndex((p) => p.item.id === id);
    if (i < 0) return;
    const [p] = this.out.splice(i, 1);
    if (!p) return;
    clearTimeout(p.timer);
    this.persist();
    this.ev.delivered?.(p.item, { waitedForLink: p.waited, resent: p.tries > 1 });
    this.ev.queue?.(this.out.length);
  }

  private persist() { this.store?.save(this.out.map((p) => p.item)); }

  private ack(id: string) { this.pipe.send({ t: 'ack', id }); }

  private async sendFileNow(item: Extract<OutItem, { kind: 'file' }>): Promise<boolean> {
    if (!this.pipe.send({ t: 'file-start', id: item.id, createdAt: item.createdAt, meta: item.meta })) return false;
    const buf = await item.blob.arrayBuffer();
    for (let off = 0; off < buf.byteLength; off += this.chunkSize) {
      await this.pipe.waitDrain();
      if (!this.pipe.sendBinary(buf.slice(off, off + this.chunkSize))) return false;
      this.ev.progress?.(item, Math.min(1, (off + this.chunkSize) / buf.byteLength));
    }
    return this.pipe.send({ t: 'file-end', id: item.id });
  }

  private log(s: string) { this.ev.log?.(s); }
}

export { PROTOCOL_VERSION };
