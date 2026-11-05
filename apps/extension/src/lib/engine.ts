// 引擎：在看不见的小页面里一直开着。连手机、收东西、写剪贴板、存照片、发通知。

import {
  CONFIG, localKV, newSecret, pairingUrl, randomId, startSession,
  type DeviceInfo, type Incoming, type Session
} from '@hutong/core';
import { browser } from 'wxt/browser';
import { copyText } from './clipboard';
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
      newerPeer: false,
      log: []
    };
  }

  async start() {
    browser.runtime.onMessage.addListener((msg: ToEngine, _sender, reply) => {
      if (msg?.to !== 'engine') return;
      if (msg.type === 'get-state') { reply(this.state); return; }
      if (msg.type === 'send-text') { reply(this.sendText(msg.text)); return; }
      if (msg.type === 'send-image-url') { void this.sendImageUrl(msg.url).then(reply); return true; }
      if (msg.type === 'send-file') { void this.sendStoredFile(msg.fileId, msg.name).then(reply); return true; }
      if (msg.type === 'reset-pairing') { void this.resetPairing().then(() => reply(this.state)); return true; }
      if (msg.type === 'log') { this.log(msg.text); return; }
      if (msg.type === 'seen') { this.setUnseen(0); return; }
    });
    this.badge();
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
      events: {
        log: (s) => this.log(s),
        signal: (s) => { this.state.signal = s; this.push(); },
        link: (s, info) => {
          this.state.link = s;
          if (info) { this.state.route = info.route; this.state.connectMs = info.connectMs; }
          if (s === 'connected' && !this.state.everPaired) { this.state.everPaired = true; kv.set('everPaired', '1'); }
          this.push();
        },
        peer: (d) => { this.state.phoneName = d.name; kv.set('phoneName', d.name); this.push(); },
        newerPeer: () => { this.state.newerPeer = true; this.push(); },
        received: (it) => void this.onReceived(it),
        delivered: (it) => { this.patch(it.id, { delivered: true }); },
        queue: (n) => {
          if (!n && this.state.pendingToPhone) this.flashOk(); // 攒着的全送到手机了
          this.state.pendingToPhone = n;
          this.push();
        }
      }
    });
  }

  private async resetPairing() {
    this.session?.close();
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

  /** 侧边栏放进小数据库的图 */
  private async sendStoredFile(fileId: string, name: string): Promise<SendResult> {
    const blob = await getFile(fileId);
    void deleteFile(fileId);
    if (!blob) return { ok: false, error: '图片没读到，请再试一次' };
    return this.sendBlob(blob, name);
  }

  private async sendBlob(blob: Blob, name: string): Promise<SendResult> {
    if (!this.session) return { ok: false, error: '插件还没准备好，请稍等再试' };
    let w: number | undefined, h: number | undefined;
    try { const b = await createImageBitmap(blob); w = b.width; h = b.height; b.close(); }
    catch { if (!blob.type.startsWith('image/')) return { ok: false, error: '这不是图片' }; }
    const out = this.session.transfer.sendFile(blob, { name, w, h });
    await putFile(out.id, blob);
    this.addItem({ id: out.id, from: 'pc', kind: 'image', time: Date.now(), size: blob.size, w, h, mime: blob.type, name, delivered: false });
    this.log(`发图片到手机：${name}，${kb(blob.size)}`);
    void pruneFiles(this.state.items.filter((x) => x.kind === 'image').map((x) => x.id));
    return { ok: true, connected: this.session.link.ready };
  }

  private async onReceived(it: Incoming) {
    if (it.kind === 'text') {
      const r = await copyText(it.text);
      this.log(`收到文字（${it.text.length} 字），自动复制${r.ok ? '成功' : '失败：' + r.how}`);
      this.addItem({ id: it.id, from: 'phone', kind: 'text', time: Date.now(), text: it.text, copied: r.ok });
      this.bg({ to: 'bg', type: 'notify', kind: 'text', title: r.ok ? '已复制手机发来的文字' : '收到手机发来的文字',
        message: it.text.slice(0, 100) });
      return;
    }
    const { blob, meta } = it;
    this.log(`收到照片 ${kb(blob.size)}，${meta.w ?? '?'}×${meta.h ?? '?'}，用时 ${it.ms} 毫秒`);
    await putFile(it.id, blob);
    this.addItem({ id: it.id, from: 'phone', kind: 'image', time: Date.now(), size: blob.size, w: meta.w, h: meta.h, mime: blob.type });
    // 自动存进电脑：「下载\互传」
    const url = URL.createObjectURL(blob);
    const saved: SavedInfo = await this.bg({ to: 'bg', type: 'save-file', url,
      filename: photoName(blob.type), fallbackName: photoName(blob.type, true) })
      .catch((e: Error) => ({ ok: false, detail: e.message }));
    setTimeout(() => URL.revokeObjectURL(url), 60000);
    this.log(saved.ok ? '照片已存到：' + saved.path : '照片没存上：' + saved.detail);
    this.patch(it.id, { saved });
    this.bg({ to: 'bg', type: 'notify', kind: 'image', itemId: it.id,
      title: saved.ok ? '收到一张照片，已存进「下载\\互传」' : '收到一张照片',
      message: '点这里复制，然后就能 Ctrl+V', imageUrl: await thumbnail(blob) });
    void pruneFiles(this.state.items.filter((x) => x.kind === 'image').map((x) => x.id));
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

  private addItem(item: Item) {
    if (item.from === 'phone') this.setUnseen(this.state.unseen + 1);
    this.state.items = [item, ...this.state.items.filter((x) => x.id !== item.id)].slice(0, MAX_ITEMS);
    this.saveItems();
    this.push();
  }

  private patch(id: string, p: Partial<Item>) {
    const it = this.state.items.find((x) => x.id === id);
    if (!it) return;
    Object.assign(it, p);
    this.saveItems();
    this.push();
  }

  private saveItems() { kv.set('items', JSON.stringify(this.state.items)); }

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
