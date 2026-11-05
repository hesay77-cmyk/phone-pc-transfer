// 把各层拼起来：介绍人（加密） → 直连 → 发一条/收一条。
// 插件和手机网页都只用这一个入口。

import { CONFIG } from './config';
import { PeerLink, type LinkInfo, type LinkState } from './link';
import type { DeviceInfo, Role } from './protocol';
import { createBus, SecureSignal, type BusStatus, type SignalBus } from './signal';
import type { KV } from './store';
import { Transfer, type TransferEvents } from './transfer';

export interface SessionEvents extends TransferEvents {
  link?(s: LinkState, info?: LinkInfo): void;
  signal?(s: BusStatus, detail: string): void;
  peer?(d: DeviceInfo): void;
  newerPeer?(): void;
}

export interface Session {
  signal: SecureSignal;
  link: PeerLink;
  transfer: Transfer;
  close(): void;
}

export async function startSession(opts: {
  role: Role;
  secret: string;
  device: DeviceInfo;
  kv: KV;
  events?: SessionEvents;
  /** 测试或以后换服务器时传入别的介绍人 */
  bus?: SignalBus;
}): Promise<Session> {
  const ev = opts.events ?? {};
  const bus = opts.bus ?? createBus(CONFIG.signal.kind, CONFIG.signal.urls, CONFIG.signal.topicPrefix);
  const signal = new SecureSignal(bus, opts.role);
  signal.onStatus((s, d) => ev.signal?.(s, d));

  let transfer: Transfer;
  const link = new PeerLink(signal, { role: opts.role, device: opts.device, iceServers: CONFIG.iceServers }, {
    log: (s) => ev.log?.(s),
    state: (s, info) => {
      ev.link?.(s, info);
      if (s === 'connected') transfer.linkUp();
    },
    heard: () => { if (transfer.pending.length) void transfer.flush(); },
    message: (m) => {
      if (m.t === 'hello') { ev.peer?.(m.device); return; }
      transfer.handle(m);
    },
    binary: (b) => transfer.handleBinary(b),
    newerPeer: () => ev.newerPeer?.()
  });
  transfer = new Transfer(link, opts.kv, ev, CONFIG.chunkSize);

  await signal.start(opts.secret);
  link.start();
  return {
    signal,
    link,
    transfer,
    close() { link.close(); signal.close(); }
  };
}
