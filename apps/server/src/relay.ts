// 介绍人服务器的核心：一个极简的「频道转发」。
// 设备连上来说「我要听 X 频道」，之后谁往 X 频道发东西，就转给听这个频道的所有人。
// 转发的内容是加密过的介绍信，服务器看不懂，也不存任何东西。

import type { IncomingMessage } from 'node:http';
import { WebSocketServer, type WebSocket } from 'ws';

export interface RelayOptions {
  /** 一条消息最大字节数（介绍信只有几 KB） */
  maxMessageBytes?: number;
  /** 每个连接最多听几个频道 */
  maxTopicsPerConn?: number;
  /** 每个连接每秒最多发几条 */
  maxMsgsPerSecond?: number;
}

const TOPIC_RE = /^[A-Za-z0-9/_-]{8,128}$/;

export function createRelay(opts: RelayOptions = {}) {
  const maxBytes = opts.maxMessageBytes ?? 64 * 1024;
  const maxTopics = opts.maxTopicsPerConn ?? 4;
  const maxRate = opts.maxMsgsPerSecond ?? 20;
  const topics = new Map<string, Set<WebSocket>>();
  const wss = new WebSocketServer({ noServer: true, maxPayload: maxBytes });

  wss.on('connection', (ws: WebSocket & { alive?: boolean }, _req: IncomingMessage) => {
    const mine = new Set<string>();
    let windowStart = Date.now(), count = 0;
    ws.alive = true;
    ws.on('pong', () => { ws.alive = true; });

    ws.on('message', (raw, isBinary) => {
      if (isBinary) return;
      const now = Date.now();
      if (now - windowStart > 1000) { windowStart = now; count = 0; }
      if (++count > maxRate) return;
      let m: any;
      try { m = JSON.parse(raw.toString()); } catch { return; }
      if (typeof m?.sub === 'string' && TOPIC_RE.test(m.sub)) {
        if (mine.size >= maxTopics && !mine.has(m.sub)) return;
        mine.add(m.sub);
        let set = topics.get(m.sub);
        if (!set) topics.set(m.sub, (set = new Set()));
        set.add(ws);
        ws.send(JSON.stringify({ ok: 'sub', topic: m.sub }));
      } else if (typeof m?.pub === 'string' && typeof m.data === 'string' && TOPIC_RE.test(m.pub)) {
        const out = JSON.stringify({ topic: m.pub, data: m.data });
        for (const peer of topics.get(m.pub) ?? []) if (peer.readyState === peer.OPEN) peer.send(out);
      }
    });

    ws.on('close', () => {
      for (const t of mine) {
        const set = topics.get(t);
        set?.delete(ws);
        if (set && set.size === 0) topics.delete(t);
      }
    });
  });

  // 30 秒检查一次，掉线的连接清掉
  const beat = setInterval(() => {
    for (const ws of wss.clients as Set<WebSocket & { alive?: boolean }>) {
      if (!ws.alive) { ws.terminate(); continue; }
      ws.alive = false;
      ws.ping();
    }
  }, 30000);
  wss.on('close', () => clearInterval(beat));

  return { wss, stats: () => ({ connections: wss.clients.size, topics: topics.size }) };
}
