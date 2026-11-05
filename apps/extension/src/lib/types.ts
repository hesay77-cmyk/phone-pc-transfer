// 插件里几块之间说话用的消息，以及侧边栏要显示的状态。
// 后台（background）只做浏览器才给它做的事：通知、下载、开窗口。
// 真正干活的是看不见的小页面（offscreen，下面叫「引擎」）：连手机、写剪贴板。
// 侧边栏只负责显示，所有状态都从引擎来。

import type { BusStatus, LinkState } from '@hutong/core';

export interface SavedInfo { ok: boolean; path?: string; downloadId?: number; detail?: string }

export interface Item {
  id: string;
  from: 'phone' | 'pc';
  kind: 'text' | 'image';
  time: number;
  text?: string;
  size?: number;
  w?: number;
  h?: number;
  mime?: string;
  saved?: SavedInfo;
  /** 文字：已自动复制 */
  copied?: boolean;
  /** 电脑发出去的：手机已收到 */
  delivered?: boolean;
}

export interface EngineState {
  version: string;
  pairingUrl: string;
  signal: BusStatus;
  link: LinkState;
  route?: string;
  connectMs?: number;
  phoneName?: string;
  everPaired: boolean;
  items: Item[];
  pendingToPhone: number;
  newerPeer: boolean;
  log: string[];
}

export type ToBg =
  | { to: 'bg'; type: 'ensure-engine' }
  | { to: 'bg'; type: 'notify'; kind: 'text' | 'image'; title: string; message: string; imageUrl?: string; itemId?: string }
  | { to: 'bg'; type: 'save-file'; url: string; filename: string; fallbackName: string }
  | { to: 'bg'; type: 'show-file'; downloadId: number };

export type ToEngine =
  | { to: 'engine'; type: 'get-state' }
  | { to: 'engine'; type: 'send-text'; text: string }
  | { to: 'engine'; type: 'reset-pairing' }
  | { to: 'engine'; type: 'log'; text: string };

export type ToPanel = { to: 'panel'; type: 'state'; state: EngineState };
