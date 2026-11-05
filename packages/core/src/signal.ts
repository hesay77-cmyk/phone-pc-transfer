// 「介绍人」这一层：两台设备在这里交换连接信息（几十到几百个字），之后就直接连，不再经过它。
// 分两层：
//   SignalBus    —— 最底下的「收发字符串」，现在用公共 MQTT，以后换自己的服务器只要再写一个实现；
//   SecureSignal —— 在上面加密、签名、防重放，介绍人看不懂、改不了、冒充不了。

import mqtt, { type MqttClient } from 'mqtt';
import { deriveKeys, open, seal, type PairKeys } from './pairing';
import { randomId, type Role } from './protocol';

export type BusStatus = 'connecting' | 'online' | 'offline';

/** 最底层：往一个频道发字符串、收字符串 */
export interface SignalBus {
  start(topic: string, onMessage: (payload: string) => void): void;
  publish(payload: string): void;
  onStatus(cb: (s: BusStatus, detail: string) => void): void;
  /**
   * 网页从后台回来（比如 iPhone 解锁）时调用。在后台待久了，到服务器的连接多半已经死了但看起来还连着，
   * 要等心跳超时（几十秒）才发现——这就是「解锁后连半天」。所以待久了就直接重新连。
   */
  wake?(hiddenMs: number): void;
  close(): void;
}

/** 在后台待超过这么久，就当介绍人那条连接已经断了 */
export const STALE_AFTER_HIDDEN_MS = 4000;

/** 用公共 MQTT 当介绍人。连不上第一个地址就换下一个。 */
export class MqttBus implements SignalBus {
  private client: MqttClient | null = null;
  private topic = '';
  private statusCb: (s: BusStatus, detail: string) => void = () => {};
  private onMessage: (p: string) => void = () => {};
  private index = 0;
  private everOnline = false;
  private giveUpTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(private urls: string[], private prefix: string) {}

  onStatus(cb: (s: BusStatus, detail: string) => void) { this.statusCb = cb; }

  start(topic: string, onMessage: (payload: string) => void) {
    this.topic = this.prefix + topic;
    this.onMessage = onMessage;
    this.connect();
  }

  private connect() {
    const url = this.urls[this.index % this.urls.length] ?? '';
    this.statusCb('connecting', url);
    const c = mqtt.connect(url, {
      clientId: 'ht_' + randomId(10),
      clean: true,
      keepalive: 30,
      reconnectPeriod: 3000,
      connectTimeout: 8000
    });
    this.client = c;
    clearTimeout(this.giveUpTimer);
    // 10 秒还没连上，而且从没连上过，就换下一个地址
    this.giveUpTimer = setTimeout(() => {
      if (!c.connected && !this.everOnline && this.urls.length > 1) {
        c.end(true);
        this.index++;
        this.connect();
      }
    }, 10000);
    const mine = () => this.client === c;
    c.on('connect', () => {
      if (!mine()) return;
      this.everOnline = true;
      clearTimeout(this.giveUpTimer);
      c.subscribe(this.topic, { qos: 0 });
      this.statusCb('online', url);
    });
    c.on('offline', () => { if (mine()) this.statusCb('offline', url); });
    c.on('reconnect', () => { if (mine()) this.statusCb('connecting', url); });
    c.on('message', (_t, payload) => { if (mine()) this.onMessage(payload.toString()); });
  }

  publish(payload: string) {
    this.client?.publish(this.topic, payload, { qos: 0 });
  }

  wake(hiddenMs: number) {
    if (!this.client || !this.topic) return;
    if (this.client.connected && hiddenMs < STALE_AFTER_HIDDEN_MS) return;
    const old = this.client;
    this.client = null;
    old.end(true);
    this.connect();
  }

  close() {
    clearTimeout(this.giveUpTimer);
    this.client?.end(true);
    this.client = null;
  }
}

/** 用我们自己的介绍人服务器（apps/server，WebSocket 频道转发）。以后正式上线用这个。 */
export class WsBus implements SignalBus {
  private ws: WebSocket | null = null;
  private topic = '';
  private onMessage: (p: string) => void = () => {};
  private statusCb: (s: BusStatus, detail: string) => void = () => {};
  private queue: string[] = [];
  private index = 0;
  private backoff = 1000;
  private closed = false;
  private retry: ReturnType<typeof setTimeout> | undefined;

  constructor(private urls: string[], private prefix: string) {}

  onStatus(cb: (s: BusStatus, detail: string) => void) { this.statusCb = cb; }

  start(topic: string, onMessage: (payload: string) => void) {
    this.topic = this.prefix + topic;
    this.onMessage = onMessage;
    this.connect();
  }

  private connect() {
    if (this.closed) return;
    const url = this.urls[this.index % this.urls.length] ?? '';
    this.statusCb('connecting', url);
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onopen = () => {
      this.backoff = 1000;
      ws.send(JSON.stringify({ sub: this.topic }));
      for (const p of this.queue.splice(0)) ws.send(JSON.stringify({ pub: this.topic, data: p }));
      this.statusCb('online', url);
    };
    ws.onmessage = (e) => {
      try {
        const m = JSON.parse(String(e.data));
        if (m && m.topic === this.topic && typeof m.data === 'string') this.onMessage(m.data);
      } catch { /* 不是给我的 */ }
    };
    ws.onclose = () => {
      if (this.ws !== ws || this.closed) return;
      this.statusCb('offline', url);
      this.index++;
      this.retry = setTimeout(() => this.connect(), this.backoff);
      this.backoff = Math.min(this.backoff * 2, 10000);
    };
  }

  wake(hiddenMs: number) {
    if (this.closed || !this.topic) return;
    if (this.ws?.readyState === WebSocket.OPEN && hiddenMs < STALE_AFTER_HIDDEN_MS) return;
    clearTimeout(this.retry);
    const old = this.ws;
    this.ws = null;
    old?.close();
    this.backoff = 1000;
    this.connect();
  }

  publish(payload: string) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify({ pub: this.topic, data: payload }));
    else { this.queue.push(payload); if (this.queue.length > 20) this.queue.shift(); }
  }

  close() {
    this.closed = true;
    clearTimeout(this.retry);
    this.ws?.close();
    this.ws = null;
  }
}

export type BusKind = 'mqtt' | 'ws';

/** 选介绍人：mqtt = 借用公共 MQTT；ws = 我们自己的服务器 */
export function createBus(kind: BusKind, urls: string[], prefix: string): SignalBus {
  return kind === 'ws' ? new WsBus(urls, prefix) : new MqttBus(urls, prefix);
}

/** 介绍信的内容 */
export type SignalMsg =
  | { type: 'pc-online' }
  | { type: 'hello'; sid: string }
  | { type: 'offer'; sid: string; sdp: string }
  | { type: 'answer'; sid: string; sdp: string };

interface Envelope { from: Role; ts: number; n: string; m: SignalMsg }

/** 介绍信的有效期：太旧的当作重放丢掉（留足手机和电脑时钟的误差） */
const MAX_AGE_MS = 10 * 60 * 1000;

export class SecureSignal {
  private keys: PairKeys | null = null;
  private seen = new Map<string, number>();
  private handlers: Array<(m: SignalMsg) => void> = [];
  private statusHandlers: Array<(s: BusStatus, detail: string) => void> = [];
  status: BusStatus = 'connecting';

  constructor(private bus: SignalBus, private role: Role) {
    bus.onStatus((s, d) => {
      this.status = s;
      this.statusHandlers.forEach((h) => h(s, d));
    });
  }

  async start(secret: string) {
    this.keys = await deriveKeys(secret);
    this.bus.start(this.keys.topic, (p) => void this.receive(p));
  }

  onMessage(h: (m: SignalMsg) => void) { this.handlers.push(h); }
  onStatus(h: (s: BusStatus, detail: string) => void) { this.statusHandlers.push(h); }
  /** 网页从后台回来：让介绍人那条连接该重连就重连 */
  wake(hiddenMs: number) { this.bus.wake?.(hiddenMs); }

  async send(m: SignalMsg) {
    if (!this.keys) return;
    const env: Envelope = { from: this.role, ts: Date.now(), n: randomId(12), m };
    this.bus.publish(await seal(this.keys.key, env));
  }

  /** 收到一封介绍信：解不开、太旧、重复、自己发的，都丢掉 */
  async receive(payload: string) {
    if (!this.keys) return;
    const env = await open<Envelope>(this.keys.key, payload);
    if (!env || !env.m || typeof env.m.type !== 'string') return;
    if (env.from === this.role) return;
    const now = Date.now();
    if (typeof env.ts !== 'number' || Math.abs(now - env.ts) > MAX_AGE_MS) return;
    if (this.seen.has(env.n)) return;
    this.seen.set(env.n, now);
    if (this.seen.size > 500) {
      for (const [n, t] of this.seen) if (now - t > MAX_AGE_MS) this.seen.delete(n);
    }
    this.handlers.forEach((h) => h(env.m));
  }

  close() { this.bus.close(); }
}
