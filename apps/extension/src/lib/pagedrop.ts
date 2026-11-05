// 侧边栏里的照片拖进网页。
// Chrome 从侧边栏拖图时，网页只拿到一个插件内部的地址（blob:chrome-extension://…），拿不到照片本身，
// 网页上传框不认；拖到空白处还会把这个打不开的地址当网页打开。
// 办法：开始拖的那一下，往当前网页里放一小段「接收员」代码。照片拖到网页上时它接住，
// 向侧边栏要来照片，做成真正的文件，再交给网页（就像从文件夹里拖进去一样）。
// 需要「在网页上读取和更改数据」的权限（和右键发网页上的图是同一个），没给就提示用户在侧边栏点「允许」。
// 拖到接收员管不到的地方（新标签页、Chrome 自己的页面、标签栏、地址栏），Chrome 会打开拖着的地址，
// 打开的应该是这张照片（跟从 QQ 拖图进 Chrome 一样）。但 Chrome 打开拖进来的地址时不说是谁打开的，
// 插件自己的页面（view.html）这样打开会被拦（ERR_BLOCKED_BY_CLIENT）：所以拖着的地址是手机网页同一网站上的
// open.html，它马上转到 view.html（从正常网站转过去 Chrome 就放行）。照片本身不经过那个网站。

import { browser } from 'wxt/browser';
import { CONFIG } from '@hutong/core';
import { getFile } from './files';
import type { ToPanel } from './types';

export const DRAG_TYPE = 'application/x-hutong-photo';

export interface DropArm { id: string; name: string }

export type ArmResult = 'ok' | 'no-permission' | 'no-page';

let seq = 0;

/** 「看照片」页面的地址 */
export const viewUrl = (id: string, name: string) =>
  browser.runtime.getURL('/view.html') + '?id=' + encodeURIComponent(id) + '&name=' + encodeURIComponent(name);

/** 拖着的地址：先到网站上的 open.html，再转到 view.html */
export const dropUrl = (id: string, name: string) =>
  CONFIG.phoneUrl.replace(/#.*$/, '').replace(/[^/]*$/, '') + 'open.html#' + encodeURIComponent(viewUrl(id, name));

/** 照片开始被拖（dragstart 里调用） */
export function startPhotoDrag(e: DragEvent, arm: DropArm, onNeedPermission?: () => void) {
  e.dataTransfer?.setData(DRAG_TYPE, arm.id);
  e.dataTransfer?.setData('text/uri-list', dropUrl(arm.id, arm.name));
  void armPageDrop(arm).then((r) => { if (r === 'no-permission') onNeedPermission?.(); });
}

/** 侧边栏 / 看照片页面开着时，回应网页里的接收员：要照片本身（消息里只能传文字，所以转成 base64），或在新标签页打开照片 */
export function servePageDrop() {
  browser.runtime.onMessage.addListener((m: ToPanel, sender, reply) => {
    if (m?.to !== 'panel') return;
    if (m.type === 'open-photo') {
      const t = sender.tab;
      void browser.tabs.create({ url: viewUrl(m.id, m.name), active: true, ...(t?.id !== undefined ? { index: t.index + 1, openerTabId: t.id, windowId: t.windowId } : {}) })
        .then(() => reply(true), () => reply(false));
      return true;
    }
    if (m.type !== 'drag-file') return;
    void (async () => {
      const blob = await getFile(m.id).catch(() => undefined);
      if (!blob) return reply({ ok: false });
      const u8 = new Uint8Array(await blob.arrayBuffer());
      let bin = '';
      for (let i = 0; i < u8.length; i += 0x8000) bin += String.fromCharCode(...u8.subarray(i, i + 0x8000));
      reply({ ok: true, b64: btoa(bin), type: blob.type });
    })();
    return true;
  });
}

/** 拖完了：过一会儿让网页里的接收员下班（这期间又开始拖别的照片就不管了） */
export function disarmPageDropSoon() {
  const mine = seq;
  setTimeout(() => { if (mine === seq) void armPageDrop(null); }, 500);
}

/** 开始拖（arm 是照片）或拖完（null）时调用：给每个窗口当前的网页放好接收员 */
export async function armPageDrop(arm: DropArm | null): Promise<ArmResult> {
  if (arm) seq++;
  if (!(await browser.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false))) return 'no-permission';
  const tabs = await browser.tabs.query({ active: true }).catch(() => []);
  const done = await Promise.all(tabs.map((t) => t.id === undefined ? false
    : browser.scripting.executeScript({ target: { tabId: t.id, allFrames: true }, func: pageDropHelper, args: [arm] })
      .then(() => true, () => false)));
  return done.some(Boolean) ? 'ok' : 'no-page';
}

/**
 * 放进网页里运行的接收员。整个函数会被转成文字塞进网页，所以不能用到函数外面的任何东西。
 * 同一个网页里只装一次，之后再调用只是换一张要接的照片（null = 不接了）。
 */
export function pageDropHelper(arm: DropArm | null) {
  type St = { set(a: DropArm | null): void };
  const w = window as unknown as { __hutongDrop?: St };
  if (w.__hutongDrop) { w.__hutongDrop.set(arm); return; }

  const TYPE = 'application/x-hutong-photo';
  const ARM_MS = 60000;
  const rt = (globalThis as any).chrome?.runtime;
  let cur: (DropArm & { at: number }) | null = null;
  let fileP: Promise<File | null> | null = null;
  let file: File | null = null;
  let firing = false; // 正在发我们自己造的事件，别再接
  let localDrag = false; // 网页自己里面在拖东西（选中文字拖动等），不关我们的事
  const entered = new Set<EventTarget>();

  w.__hutongDrop = { set(a) { cur = a ? { ...a, at: Date.now() } : null; fileP = null; file = null; entered.clear(); } };
  w.__hutongDrop.set(arm);

  const ours = (e: DragEvent) => {
    // 只认浏览器发的真拖拽：别的网页自己造的假拖拽事件拿不到照片
    if (firing || localDrag || !e.isTrusted || !e.dataTransfer) return false;
    const types = Array.from(e.dataTransfer.types);
    if (types.includes(TYPE)) return true;
    return !!cur && Date.now() - cur.at < ARM_MS && !types.includes('Files');
  };

  const getFile = (e: DragEvent): Promise<File | null> => {
    if (fileP) return fileP;
    const id = cur?.id || e.dataTransfer?.getData(TYPE) || '';
    const name = cur?.name;
    fileP = new Promise((resolve) => {
      if (!id || !rt) return resolve(null);
      rt.sendMessage({ to: 'panel', type: 'drag-file', id }, (r: { ok: boolean; b64?: string; type?: string } | undefined) => {
        if (rt.lastError || !r?.ok || !r.b64) return resolve(null);
        const bin = atob(r.b64);
        const u8 = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
        const type = r.type || 'image/jpeg';
        const ext = ({ 'image/png': 'png', 'image/gif': 'gif', 'image/webp': 'webp', 'image/heic': 'heic' } as Record<string, string>)[type] || 'jpg';
        resolve((file = new File([u8], name || '照片.' + ext, { type, lastModified: Date.now() })));
      });
    });
    return fileP;
  };

  const withFile = (f: File) => { const d = new DataTransfer(); d.items.add(f); return d; };

  /** 在 target 上发一个带着照片文件的拖拽事件；返回网页有没有接（preventDefault） */
  const fire = (target: EventTarget, type: string, src: DragEvent, f: File) => {
    firing = true;
    try {
      const ev = new DragEvent(type, {
        bubbles: true, cancelable: true, composed: true, dataTransfer: withFile(f),
        clientX: src.clientX, clientY: src.clientY, screenX: src.screenX, screenY: src.screenY,
        ctrlKey: src.ctrlKey, shiftKey: src.shiftKey, altKey: src.altKey, metaKey: src.metaKey
      });
      target.dispatchEvent(ev);
      return ev.defaultPrevented;
    } finally {
      firing = false;
    }
  };

  const targetOf = (e: Event) => (e.composedPath()[0] as EventTarget | undefined) ?? e.target ?? document.body;

  // 拖进来、拖着移动、拖出去：先挡住浏览器的默认处理（会把地址当网页打开），照片到手后转给网页，让它的上传区亮起来
  const onMove = (e: DragEvent) => {
    if (!ours(e)) return;
    e.stopImmediatePropagation();
    if (e.type !== 'dragleave') { e.preventDefault(); e.dataTransfer!.dropEffect = 'copy'; }
    void getFile(e);
    const t = targetOf(e);
    if (!file) return;
    if (e.type === 'dragleave') {
      if (entered.delete(t)) fire(t, 'dragleave', e, file);
      return;
    }
    if (!entered.has(t)) { entered.add(t); fire(t, 'dragenter', e, file); }
    if (e.type === 'dragover') fire(t, 'dragover', e, file);
  };

  const onDrop = (e: DragEvent) => {
    if (!ours(e)) return;
    e.stopImmediatePropagation();
    e.preventDefault();
    const t = targetOf(e);
    const fp = getFile(e);
    const pending = [...entered];
    const photo = cur ?? { id: e.dataTransfer?.getData(TYPE) || '', name: '' };
    w.__hutongDrop!.set(null);
    void fp.then((f) => {
      if (!f) return toast('照片没取到，请再拖一次', false);
      for (const x of pending) if (x !== t) fire(x, 'dragleave', e, f);
      // 1) 网页自己接拖进来的文件（大多数上传区、聊天框）
      if (fire(t, 'drop', e, f)) return;
      // 2) 拖到了「选择文件」按钮或上传框上
      if (toInput(t, f)) return;
      // 3) 拖到了输入框里：当作粘贴（很多聊天、AI 网站的输入框支持粘贴图片）
      if (pasteInto(t, f)) return;
      // 4) 都不收：像 Chrome 打开拖进来的图片一样，在旁边新标签页打开这张照片（不把当前网页换掉）
      rt.sendMessage({ to: 'panel', type: 'open-photo', id: photo.id, name: f.name }, (ok: boolean | undefined) => {
        if (rt.lastError || !ok) toast('这个位置放不了图片。拖到网页的上传框或聊天输入框里，或者在侧边栏点「复制这张图」再 Ctrl+V', false);
      });
    });
  };

  const accepts = (inp: HTMLInputElement, f: File) => {
    const acc = inp.accept.trim().toLowerCase();
    if (!acc) return true;
    const ext = '.' + (f.name.split('.').pop() || '').toLowerCase();
    return acc.split(',').map((s) => s.trim()).some((a) => a === 'image/*' || a === f.type || a === ext);
  };

  const toInput = (t: EventTarget, f: File) => {
    let inp: HTMLInputElement | null = null;
    let el = t instanceof Element ? t : null;
    if (el?.closest('label') && (el.closest('label') as HTMLLabelElement).control instanceof HTMLInputElement) {
      const c = (el.closest('label') as HTMLLabelElement).control as HTMLInputElement;
      if (c.type === 'file') inp = c;
    }
    for (let i = 0; !inp && el && el !== document.body && i < 4; i++, el = el.parentElement) {
      if (el instanceof HTMLInputElement && el.type === 'file') { inp = el; break; }
      const found = el.querySelectorAll('input[type=file]');
      if (found.length === 1) inp = found[0] as HTMLInputElement;
      else if (found.length > 1) break;
    }
    if (!inp || inp.disabled || !accepts(inp, f)) return false;
    inp.files = withFile(f).files;
    inp.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
    inp.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  };

  const pasteInto = (t: EventTarget, f: File) => {
    const el = t instanceof Element ? t : null;
    const ed = el?.closest('textarea, input:not([type]), input[type=text], input[type=search], [contenteditable=""], [contenteditable="true"], [contenteditable="plaintext-only"]') as HTMLElement | null;
    if (!ed) return false;
    ed.focus();
    const target = (document.activeElement && ed.contains(document.activeElement) ? document.activeElement : ed) as HTMLElement;
    const ev = new ClipboardEvent('paste', { bubbles: true, cancelable: true, composed: true, clipboardData: withFile(f) });
    target.dispatchEvent(ev);
    return ev.defaultPrevented;
  };

  const toast = (text: string, ok: boolean) => {
    document.getElementById('hutong-toast')?.remove();
    const host = document.createElement('div');
    host.id = 'hutong-toast';
    host.dataset.ok = String(ok);
    const box = document.createElement('div');
    box.textContent = text;
    box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:340px;padding:12px 16px;border-radius:12px;'
      + 'font:15px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);'
      + 'background:' + (ok ? '#16a34a' : '#b45309');
    host.attachShadow({ mode: 'open' }).appendChild(box);
    document.documentElement.appendChild(host);
    setTimeout(() => host.remove(), ok ? 2500 : 7000);
  };

  addEventListener('dragstart', () => { localDrag = true; }, true);
  addEventListener('dragend', () => { localDrag = false; }, true);
  for (const type of ['dragenter', 'dragover', 'dragleave']) addEventListener(type, onMove as EventListener, true);
  addEventListener('drop', onDrop, true);
}
