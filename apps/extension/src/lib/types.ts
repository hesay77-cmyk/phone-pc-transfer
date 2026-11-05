// 插件里几块之间说话用的消息，以及侧边栏要显示的状态。
// 后台（background）只做浏览器才给它做的事：通知、下载、开窗口。
// 真正干活的是看不见的小页面（offscreen，下面叫「引擎」）：连手机、写剪贴板。
// 侧边栏只负责显示，所有状态都从引擎来。

import type { BusStatus, LinkState } from '@hutong/core';

export interface SavedInfo { ok: boolean; path?: string; downloadId?: number; detail?: string }

export interface Item {
  id: string;
  from: 'phone' | 'pc';
  kind: 'text' | 'image' | 'file';
  time: number;
  text?: string;
  size?: number;
  w?: number;
  h?: number;
  mime?: string;
  name?: string;
  saved?: SavedInfo;
  /** 文字：已自动复制 */
  copied?: boolean;
  /** 电脑发出去的：手机已收到 */
  delivered?: boolean;
  /** 电脑发出去的：不发了（自己取消 / 放了一天还没送到 / 怎么都发不出去） */
  dropped?: 'cancelled' | 'expired' | 'failed';
  /** 文字太长，记录里只存了开头 */
  cut?: boolean;
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
  /** 电脑上复制的文字自动发到手机 */
  autoSend: boolean;
  /** 新收到、还没打开侧边栏看过的条数 */
  unseen: number;
  newerPeer: boolean;
  /** 刚连上的是一台以前没连过的手机（名字），提醒用户确认是自己的 */
  newPhone?: string;
  /** 「复制就发」跳过了一条像密码的内容（时间），提醒用户 */
  skippedSecretAt?: number;
  log: string[];
}

export type ToBg =
  | { to: 'bg'; type: 'ensure-engine' }
  | { to: 'bg'; type: 'notify'; kind: 'text' | 'image'; title: string; message: string; imageUrl?: string; itemId?: string }
  | { to: 'bg'; type: 'save-file'; url: string; filename: string; fallbackName: string }
  | { to: 'bg'; type: 'show-file'; downloadId: number }
  /** 插件图标上的小角标：有几条新收到的没看，或者刚送到手机的 ✓ */
  | { to: 'bg'; type: 'badge'; text: string; color: string };

/** 发到手机的结果 */
export interface SendResult { ok: boolean; connected?: boolean; error?: string; /** 发的是什么，给用户看 */ what?: string }

export type ToEngine =
  | { to: 'engine'; type: 'get-state' }
  | { to: 'engine'; type: 'send-text'; text: string }
  /** 还没送到手机的，不发了 */
  | { to: 'engine'; type: 'cancel'; id: string }
  /** 清空侧边栏里的记录（还没送到的留着） */
  | { to: 'engine'; type: 'clear-items' }
  /** 删掉一条记录（还没送到的顺便不发了） */
  | { to: 'engine'; type: 'delete-item'; id: string }
  /** 关掉「新手机连上了」「跳过了像密码的」这类提醒 */
  | { to: 'engine'; type: 'dismiss'; what: 'newPhone' | 'skippedSecret' }
  /** 网页上右键「把这张图发到手机」：引擎自己去下载这张图 */
  | { to: 'engine'; type: 'send-image-url'; url: string }
  /** 把剪贴板里的东西（刚复制的文字，或刚截的图）发到手机：快捷键和侧边栏按钮都用它 */
  | { to: 'engine'; type: 'send-clipboard' }
  | { to: 'engine'; type: 'set-auto-send'; on: boolean }
  /** 侧边栏里选的/粘贴的/拖进来的图或文件：先放进小数据库，再告诉引擎 id */
  | { to: 'engine'; type: 'send-file'; fileId: string; name: string }
  | { to: 'engine'; type: 'reset-pairing' }
  /** 侧边栏开着、看过了：清掉图标上的数字 */
  | { to: 'engine'; type: 'seen' }
  | { to: 'engine'; type: 'log'; text: string };

export type ToPanel = { to: 'panel'; type: 'state'; state: EngineState } | { to: 'panel'; type: 'drag-file'; id: string }
  | { to: 'panel'; type: 'open-photo'; id: string; name: string };
