// 引擎：在看不见的小页面里一直开着。连手机、收东西、写剪贴板、存照片、发通知。

import {
  asciiFileName, BlobStore, CONFIG, isShowableImage, localKV, looksLikePassword, persistentOutbox, newSecret, pairingUrl, randomId, safeFileName,
  sizeText, startSession, trimForHistory,
  type DeviceInfo, type Incoming, type Session
} from '@hutong/core';
import { browser } from 'wxt/browser';
import { copyText, readClipboard } from './clipboard';
import { deleteFile, getFile, photoName, pruneFiles, putFile, thumbnail } from './files';
import type { EngineState, Item, SavedInfo, SendResult, ToBg, ToEngine, ToPanel } from './types';

const kv = localKV('hutong:pc:');
const MAX_ITEMS = 30;

function loadItems(): Item[] {
  try { return JSON.parse(kv.get('items') || '[]'); } catch { return []; }
}

export class Engine {
  private session: Session | null = null;
  private state: EngineState;
  private pushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    let secret = kv.get('secret');
    if (!secret) { secret = newSecret(); kv.set('secret', secret); }
    this.state = {
      version: __APP_VERSION__,
      pairingUrl: pairingUrl(CONFIG.phoneUrl, secret),
      signal: 'connecting',
      link: 'idle',
      everPaired: kv.get('everPaired') === '1',
      phoneName: kv.get('phoneName') || undefined,
      items: loadItems(),
      pendingToPhone: 0,
      unseen: Number(kv.get('unseen') || 0),
      autoSend: kv.get('autoSend') === '1',
      newerPeer: false,
      log: []
    };
  }

  async start() {
    browser.runtime.onMessage.addListener((msg: ToEngine, _sender, reply) => {
      if (msg?.to !== 'engine') return;
      if (msg.type === 'get-state') { reply(this.state); return; }
      if (msg.type === 'send-text') { reply(this.sendText(msg.text)); return; }
      if (msg.type === 'cancel') { if (!this.session?.transfer.cancel(msg.id)) this.patch(msg.id, { dropped: 'cancelled' }); reply(this.state); return; }
      if (msg.type === 'clear-items') { this.clearItems(); reply(this.state); return; }
      if (msg.type === 'delete-item') { this.deleteItem(msg.id); reply(this.state); return; }
      if (msg.type === 'dismiss') {
        if (msg.what === 'newPhone') this.state.newPhone = undefined; else this.state.skippedSecretAt = undefined;
        this.push(); reply(this.state); return;
      }
      if (msg.type === 'send-image-url') { void this.sendImageUrl(msg.url).then(reply); return true; }
      if (msg.type === 'send-clipboard') { void this.sendClipboard().then(reply); return true; }
      if (msg.type === 'set-auto-send') { this.setAutoSend(msg.on); reply(this.state); return; }
      if (msg.type === 'send-file') { void this.sendStoredFile(msg.fileId, msg.name).then(reply); return true; }
      if (msg.type === 'reset-pairing') { void this.resetPairing().then(() => reply(this.state)); return true; }
      if (msg.type === 'log') { this.log(msg.text); return; }
      if (msg.type === 'seen') { this.setUnseen(0); return; }
    });
    this.badge();
    this.setAutoSend(this.state.autoSend);
    await this.connect();
  }

  private device(): DeviceInfo {
    let id = kv.get('deviceId');
    if (!id) { id = randomId(); kv.set('deviceId', id); }
    return { id, role: 'pc', name: /Windows/.test(navigator.userAgent) ? 'Windows 电脑' : '电脑', app: this.state.version };
  }

  private async connect() {
    const secret = kv.get('secret')!;
    this.session = await startSession({
      role: 'pc',
      secret,
      device: this.device(),
      kv,
      // 没送到手机的存在本机，关掉 Chrome 再打开也接着送
      outbox: persistentOutbox(kv, new BlobStore('hutong-out', 'files', 50)),
      events: {
        log: (s) => this.log(s),
        signal: (s) => { this.state.signal = s; this.push(); },
        link: (s, info) => {
          this.state.link = s;
          if (info) { this.state.route = info.route; this.state.connectMs = info.connectMs; }
          if (s === 'connected' && info) this.log(`连上手机：${info.route}，${info.connectMs} 毫秒`);
          if (s === 'connected' && !this.state.everPaired) { this.state.everPaired = true; kv.set('everPaired', '1'); }
          if (s === 'connected') this.sendPendingClip();
          this.push();
        },
        peer: (d) => {
          this.state.phoneName = d.name;
          kv.set('phoneName', d.name);
          // 以前没连过的手机：提醒一下（拿到过二维码的人在同一个 Wi-Fi 下也能连上来）
          let known: string[] = [];
          try { known = JSON.parse(kv.get('knownPhones') || '[]'); } catch { known = []; }
          if (!known.includes(d.id)) {
            if (known.length) { this.state.newPhone = d.name || '手机'; this.log('一台新手机连上了：' + (d.name || '手机')); }
            kv.set('knownPhones', JSON.stringify([...known, d.id].slice(-10)));
          }
          this.push();
        },
        newerPeer: () => { this.state.newerPeer = true; this.push(); },
        received: (it) => void this.onReceived(it),
        delivered: (it) => { this.patch(it.id, { delivered: true }); },
        dropped: (it, why) => { this.patch(it.id, { dropped: why }); },
        queue: (n) => {
          if (!n && this.state.pendingToPhone) this.flashOk(); // 攒着的全送到手机了
          this.state.pendingToPhone = n;
          this.push();
        }
      }
    });
  }

  private async resetPairing() {
    // 旧的没送到的不该送到新配对的手机上
    this.session?.transfer.clear();
    this.session?.close();
    kv.remove('knownPhones');
    this.state.newPhone = undefined;
    const secret = newSecret();
    kv.set('secret', secret);
    kv.remove('everPaired');
    this.state.everPaired = false;
    this.state.pairingUrl = pairingUrl(CONFIG.phoneUrl, secret);
    this.state.link = 'idle';
    this.log('换了新的配对码，之前的手机要重新扫码');
    await this.connect();
  }

  private sendText(text: string): SendResult {
    if (!this.session || !text.trim()) return { ok: false, error: '没有可发的文字' };
    const out = this.session.transfer.sendText(text);
    this.addItem({ id: out.id, from: 'pc', kind: 'text', time: Date.now(), text, delivered: false });
    return { ok: true, connected: this.session.link.ready };
  }

  // ---------- 复制就自动发：每隔一会儿看一眼剪贴板，文字变了、手机连着，就发过去 ----------
  private lastClip = '';
  private clipTimer: ReturnType<typeof setInterval> | undefined;

  private setAutoSend(on: boolean) {
    this.state.autoSend = on;
    kv.set('autoSend', on ? '1' : '0');
    clearInterval(this.clipTimer);
    if (on) {
      this.lastClip = readClipboard(false).text; // 打开开关时剪贴板里原有的不发
      this.clipTimer = setInterval(() => this.watchClipboard(), 700);
    }
    this.push();
  }

  private pendingClip: { text: string; at: number } | null = null;

  private watchClipboard() {
    const c = readClipboard(false);
    if (!c.ok || c.text === this.lastClip) return;
    this.lastClip = c.text;
    if (!c.text.trim()) return;
    // 从密码管理器里复制的密码不自动发（要发可以点「发刚复制的」）
    if (looksLikePassword(c.text)) { this.state.skippedSecretAt = Date.now(); this.log('复制的内容像密码，没有自动发'); this.push(); return; }
    // 手机没连着（锁屏、网页没开）：只记住最后一条，连上后送这一条，不攒一堆
    if (!this.session?.link.ready) { this.pendingClip = { text: c.text, at: Date.now() }; return; }
    this.pendingClip = null;
    this.sendText(c.text);
    this.log(`复制就发：${c.text.length} 个字`);
  }

  /** 手机连上了：把没连着时最后复制的那条送过去（10 分钟以前的就算了） */
  private sendPendingClip() {
    const p = this.pendingClip;
    this.pendingClip = null;
    if (!p || !this.state.autoSend || Date.now() - p.at > 10 * 60_000) return;
    this.sendText(p.text);
    this.log(`复制就发：手机连上了，补发最后复制的 ${p.text.length} 个字`);
  }

  /** 剪贴板里有图（截图）就发图，否则发文字 */
  private async sendClipboard(): Promise<SendResult> {
    const c = readClipboard();
    if (!c.ok) { this.log('读剪贴板失败'); return { ok: false, error: '读不到剪贴板。可以把内容粘贴到侧边栏的输入框里再发' }; }
    // 截的图，或者在文件夹里复制的文件
    if (c.files.length) {
      let r: SendResult = { ok: false };
      const t = new Date().toLocaleTimeString().replace(/:/g, '-');
      for (const f of c.files) r = await this.sendBlob(f, f.name && f.name !== 'image.png' ? f.name : `截图 ${t}.png`);
      const allImg = c.files.every((f) => f.type.startsWith('image/'));
      const n = c.files.length;
      return { ...r, what: allImg ? (n > 1 ? `${n} 张图` : '截图') : (n > 1 ? `${n} 个文件` : `「${c.files[0]!.name}」`) };
    }
    if (!c.text.trim()) return { ok: false, error: '剪贴板是空的。先复制一段文字（Ctrl+C）或截个图，再发' };
    const r = this.sendText(c.text);
    const head = c.text.trim().replace(/\s+/g, ' ');
    return { ...r, what: `「${head.length > 20 ? head.slice(0, 20) + '…' : head}」` };
  }

  /** 网页上的图：插件自己下载下来再发（需要用户点过「允许」读取网页图片） */
  private async sendImageUrl(url: string): Promise<SendResult> {
    let blob: Blob;
    try {
      const r = await fetch(url);
      if (!r.ok) throw new Error(String(r.status));
      blob = await r.blob();
    } catch (e) {
      this.log(`下载网页图片失败（${String(e)}）：${url.slice(0, 120)}`);
      return { ok: false, error: '这张图下载不下来。可以先把图存到电脑，再拖进侧边栏发送' };
    }
    const name = decodeURIComponent(url.startsWith('data:') ? '' : (new URL(url).pathname.split('/').pop() ?? '')) || '图片';
    return this.sendBlob(blob, name);
  }

  /** 侧边栏放进小数据库的图片或文件 */
  private async sendStoredFile(fileId: string, name: string): Promise<SendResult> {
    const blob = await getFile(fileId);
    void deleteFile(fileId);
    if (!blob) return { ok: false, error: '没读到这个文件，请再试一次' };
    return this.sendBlob(blob, name);
  }

  /** 发图片或文件到手机。能直接显示的图片当照片发（侧边栏、手机上都能看到图），别的当文件 */
  private async sendBlob(blob: Blob, name: string): Promise<SendResult> {
    if (!this.session) return { ok: false, error: '插件还没准备好，请稍等再试' };
    if (blob.size > CONFIG.maxFileBytes) {
      return { ok: false, error: `「${name}」太大了（${sizeText(blob.size)}），一次最多发 ${sizeText(CONFIG.maxFileBytes)}` };
    }
    let w: number | undefined, h: number | undefined;
    let isImg = isShowableImage(blob.type);
    // 有的网站给图片标的类型不对：能当图片打开的就当图片
    if (isImg || !blob.type || blob.type === 'application/octet-stream') {
      try {
        const b = await createImageBitmap(blob);
        w = b.width; h = b.height; b.close();
        if (!isImg) { blob = new Blob([blob], { type: 'image/png' }); isImg = true; }
      } catch { /* 不是图片，或读不到尺寸 */ }
    }
    const out = this.session.transfer.sendFile(blob, { name, w, h });
    if (isImg) await putFile(out.id, blob);
    this.addItem({ id: out.id, from: 'pc', kind: isImg ? 'image' : 'file', time: Date.now(), size: blob.size, w, h, mime: blob.type, name, delivered: false });
    this.log(`发${isImg ? '图片' : '文件'}到手机：${name}，${kb(blob.size)}`);
    if (isImg) void pruneFiles(this.state.items.filter((x) => x.kind === 'image').map((x) => x.id));
    return { ok: true, connected: this.session.link.ready, what: isImg ? '图片' : '文件' };
  }

  private async onReceived(it: Incoming) {
    if (it.kind === 'text') {
      const r = await copyText(it.text);
      if (r.ok) this.lastClip = it.text; // 这是手机发来的，别再自动发回去
      this.log(`收到文字（${it.text.length} 字），自动复制${r.ok ? '成功' : '失败：' + r.how}`);
      this.addItem({ id: it.id, from: 'phone', kind: 'text', time: Date.now(), text: it.text, copied: r.ok });
      this.bg({ to: 'bg', type: 'notify', kind: 'text', title: r.ok ? '已复制手机发来的文字' : '收到手机发来的文字',
        message: it.text.slice(0, 100) });
      return;
    }
    const { blob, meta } = it;
    const isImg = isShowableImage(blob.type || meta.mime);
    const what = isImg ? '照片' : `文件「${meta.name}」`;
    this.log(`收到${what} ${kb(blob.size)}，用时 ${it.ms} 毫秒`);
    if (isImg) await putFile(it.id, blob);
    this.addItem({ id: it.id, from: 'phone', kind: isImg ? 'image' : 'file', time: Date.now(), size: blob.size,
      w: meta.w, h: meta.h, mime: blob.type || meta.mime, name: meta.name });
    // 自动存进电脑：「下载\Tapaste」
    const url = URL.createObjectURL(blob);
    const saved: SavedInfo = await this.bg({ to: 'bg', type: 'save-file', url,
      filename: isImg ? photoName(blob.type) : safeFileName(meta.name),
      fallbackName: isImg ? photoName(blob.type, true) : asciiFileName(meta.name, 'phone-file') })
      .catch((e: Error) => ({ ok: false, detail: e.message }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    this.log(saved.ok ? `${what}已存到：` + saved.path : `${what}没存上：` + saved.detail);
    this.patch(it.id, { saved });
    if (isImg) {
      this.bg({ to: 'bg', type: 'notify', kind: 'image', itemId: it.id,
        title: saved.ok ? '收到一张照片，已存进「下载\\Tapaste」' : '收到一张照片',
        message: '点这里复制，然后就能 Ctrl+V', imageUrl: await thumbnail(blob) });
      void pruneFiles(this.state.items.filter((x) => x.kind === 'image').map((x) => x.id));
    } else {
      this.bg({ to: 'bg', type: 'notify', kind: 'text', title: saved.ok ? '收到一个文件，已存进「下载\\Tapaste」' : '收到一个文件',
        message: `${meta.name}（${sizeText(blob.size)}）` });
    }
  }

  // ---------- 插件图标上的角标：新收到几条（蓝色数字）；发到手机送到了闪一下绿色 ✓ ----------
  private flashing: ReturnType<typeof setTimeout> | undefined;

  private setUnseen(n: number) {
    if (n === this.state.unseen) return;
    this.state.unseen = n;
    kv.set('unseen', String(n));
    this.badge();
    this.push();
  }

  private flashOk() {
    clearTimeout(this.flashing);
    this.flashing = setTimeout(() => { this.flashing = undefined; this.badge(); }, 2500);
    this.badge();
  }

  private badge() {
    const n = this.state.unseen;
    this.bg(this.flashing
      ? { to: 'bg', type: 'badge', text: '✓', color: '#16a34a' }
      : { to: 'bg', type: 'badge', text: n ? String(Math.min(n, 99)) : '', color: '#2563eb' });
  }

  /** 记录还没加进列表、手机那边就已经确认收到了（小图在本机存好之前就送到了）：先记着，加进列表时补上 */
  private early = new Map<string, Partial<Item>>();

  private addItem(item: Item) {
    const e = this.early.get(item.id);
    if (e) { Object.assign(item, e); this.early.delete(item.id); }
    if (item.from === 'phone') this.setUnseen(this.state.unseen + 1);
    this.state.items = [item, ...this.state.items.filter((x) => x.id !== item.id)].slice(0, MAX_ITEMS);
    this.saveItems();
    this.push();
  }

  private patch(id: string, p: Partial<Item>) {
    const it = this.state.items.find((x) => x.id === id);
    if (!it) {
      this.early.set(id, { ...this.early.get(id), ...p });
      if (this.early.size > 50) this.early.delete(this.early.keys().next().value!);
      return;
    }
    Object.assign(it, p);
    this.saveItems();
    this.push();
  }

  /** 存记录：太长的文字只存开头，免得本机存储满了整个记录都存不上 */
  private saveItems() {
    kv.set('items', JSON.stringify(this.state.items.map((it) => {
      if (it.kind !== 'text' || !it.text) return it;
      const t = trimForHistory(it.text);
      return t.cut ? { ...it, text: t.text, cut: true } : it;
    })));
  }

  /** 删掉一条（侧边栏每条右上角的小垃圾桶）。还没送到手机的顺便不发了；存进「下载\Tapaste」的照片文件不动 */
  private deleteItem(id: string) {
    const it = this.state.items.find((x) => x.id === id);
    if (!it) return;
    if (it.from === 'pc' && !it.delivered && !it.dropped) this.session?.transfer.cancel(id);
    this.state.items = this.state.items.filter((x) => x.id !== id);
    this.early.delete(id);
    this.saveItems();
    if (it.kind === 'image') void deleteFile(id);
    this.log('删了一条记录');
    this.push();
  }

  /** 清空记录：还没送到手机的留着（它们还在待发） */
  private clearItems() {
    const pending = new Set(this.session?.transfer.pending.map((p) => p.id) ?? []);
    this.state.items = this.state.items.filter((it) => pending.has(it.id));
    this.saveItems();
    this.setUnseen(0);
    void pruneFiles(this.state.items.filter((x) => x.kind === 'image').map((x) => x.id));
    this.log('清空了记录');
    this.push();
  }

  private log(s: string) {
    this.state.log = [new Date().toLocaleTimeString() + '  ' + s, ...this.state.log].slice(0, 100);
    this.push();
  }

  /** 状态有变化就告诉侧边栏（合并成一次） */
  private push() {
    clearTimeout(this.pushTimer);
    this.pushTimer = setTimeout(() => {
      const msg: ToPanel = { to: 'panel', type: 'state', state: this.state };
      browser.runtime.sendMessage(msg).catch(() => { /* 侧边栏没开 */ });
    }, 30);
  }

  private bg(msg: ToBg): Promise<any> {
    const p = browser.runtime.sendMessage(msg);
    if (msg.type === 'notify' || msg.type === 'badge') p.catch(() => { /* 通知不需要回复 */ });
    return p;
  }
}

const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');
