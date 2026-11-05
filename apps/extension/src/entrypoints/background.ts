// 后台：浏览器只让它做的几件事——开引擎页面、弹通知、存文件、开小窗口。

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { SavedInfo, SendResult, ToBg, ToEngine } from '../lib/types';

export default defineBackground(() => {
  const ENGINE = '/offscreen.html';

  async function ensureEngine() {
    try {
      if (await browser.offscreen.hasDocument()) return;
      await browser.offscreen.createDocument({
        url: ENGINE,
        reasons: ['WEB_RTC', 'CLIPBOARD'],
        justification: '保持和手机的直连，并把手机发来的文字放进剪贴板'
      });
    } catch (e) {
      if (!String(e).includes('single offscreen')) console.warn('开引擎失败', e);
    }
  }

  browser.runtime.onInstalled.addListener(() => {
    browser.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
    makeMenus();
    void ensureEngine();
  });
  browser.runtime.onStartup.addListener(() => void ensureEngine());
  void ensureEngine();

  browser.runtime.onMessage.addListener((msg: ToBg, _sender, reply) => {
    if (msg?.to !== 'bg') return;
    switch (msg.type) {
      case 'ensure-engine':
        void ensureEngine().then(() => reply(true));
        return true;
      case 'notify':
        notify(msg);
        return;
      case 'save-file':
        void saveFile(msg.url, msg.filename, msg.fallbackName).then(reply);
        return true;
      case 'show-file':
        try { browser.downloads.show(msg.downloadId); } catch { void browser.downloads.showDefaultFolder(); }
        return;
      case 'badge':
        void browser.action.setBadgeBackgroundColor({ color: msg.color });
        void browser.action.setBadgeText({ text: msg.text });
        return;
    }
  });

  // ---------- 网页上右键「发到手机」 ----------
  const MENUS: { id: string; title: string; contexts: ['selection' | 'link' | 'image' | 'page'] }[] = [
    { id: 'sel', title: '把选中的文字发到手机', contexts: ['selection'] },
    { id: 'link', title: '把这个链接发到手机', contexts: ['link'] },
    { id: 'img', title: '把这张图发到手机', contexts: ['image'] },
    { id: 'page', title: '把这个网页的网址发到手机', contexts: ['page'] }
  ];
  function makeMenus() {
    void browser.contextMenus.removeAll().then(() => { for (const m of MENUS) browser.contextMenus.create(m); });
  }
  browser.contextMenus.onClicked.addListener((info, tab) => void menuClicked(info, tab));

  interface MenuInfo { menuItemId: string | number; selectionText?: string; linkUrl?: string; srcUrl?: string; pageUrl?: string; frameId?: number }

  async function menuClicked(info: MenuInfo, tab?: { id?: number; url?: string }) {
    // 发网页上的图要用户「允许」一次；只能在点菜单的这一下问，晚了 Chrome 就不弹了
    const isImg = info.menuItemId === 'img';
    const asked = isImg && !info.srcUrl?.startsWith('data:')
      ? browser.permissions.request({ origins: ['<all_urls>'] }).catch(() => false) : Promise.resolve(true);
    await ensureEngine();
    let r: SendResult;
    if (info.menuItemId === 'sel') {
      r = await toEngine({ type: 'send-text', text: (await selectedText(tab?.id, info.frameId)) || info.selectionText || '' });
    } else if (info.menuItemId === 'link') {
      r = await toEngine({ type: 'send-text', text: info.linkUrl ?? '' });
    } else if (isImg) {
      const allowed = await asked;
      r = await toEngine({ type: 'send-image-url', url: info.srcUrl ?? '' });
      if (!r.ok && !allowed) {
        void browser.storage.local.set({ needImagePermission: true });
        r.error = '第一次发网页上的图，要先允许一下：打开 Tapaste 侧边栏，点「允许」，再右键发一次';
      }
    } else {
      r = await toEngine({ type: 'send-text', text: info.pageUrl || tab?.url || '' });
    }
    const text = r.ok ? (r.connected ? '已发到手机' : '手机没打开 Tapaste 网页，先存着，打开后自动送到') : (r.error || '没发出去');
    if (!(await toast(tab?.id, text, r.ok)) && !r.ok) notify({ to: 'bg', type: 'notify', kind: 'text', title: '没发到手机', message: text });
  }
  // ---------- 快捷键：把刚复制的内容发到手机（在任何软件里复制完按一下） ----------
  browser.commands.onCommand.addListener((cmd, tab) => { if (cmd === 'send-clipboard') void sendClipboard(tab); });

  async function sendClipboard(tab?: { id?: number }) {
    await ensureEngine();
    const r: SendResult = await browser.runtime.sendMessage({ to: 'engine', type: 'send-clipboard' } satisfies ToEngine)
      .catch(() => ({ ok: false, error: '插件后台没响应，请再试一次' }));
    const text = r.ok ? (r.connected ? `${r.what ?? ''}已发到手机` : `${r.what ?? ''}先存着，手机打开 Tapaste 网页后自动送到`) : (r.error || '没发出去');
    // Chrome 在前台：网页右下角闪提示；在别的软件里：用系统通知（被关了也没关系，手机上会收到）
    const w = await browser.windows.getLastFocused().catch(() => null);
    if (!(w?.focused && (await toast(tab?.id, text, r.ok)))) {
      notify({ to: 'bg', type: 'notify', kind: 'text', title: r.ok ? '已发到手机' : '没发到手机', message: text });
    }
  }

  // 自动测试用：测试脚本没法点真的右键菜单、按全局快捷键，直接调这些
  if (import.meta.env.VITE_E2E) Object.assign(globalThis, { __menuClicked: menuClicked, __sendClipboard: sendClipboard });

  const toEngine = (m: { type: 'send-text'; text: string } | { type: 'send-image-url'; url: string }): Promise<SendResult> =>
    browser.runtime.sendMessage({ to: 'engine', ...m } satisfies ToEngine).catch(() => ({ ok: false, error: '插件后台没响应，请再试一次' }));

  /** 网页里选中的字（带换行；Chrome 直接给的会把换行吃掉） */
  async function selectedText(tabId?: number, frameId?: number): Promise<string> {
    if (tabId === undefined) return '';
    try {
      const [res] = await browser.scripting.executeScript({
        target: { tabId, frameIds: [frameId ?? 0] },
        func: () => {
          const el = document.activeElement as HTMLInputElement | null;
          if (el && /^(TEXTAREA|INPUT)$/.test(el.tagName) && el.selectionStart !== null && el.selectionEnd !== null) {
            return el.value.slice(el.selectionStart, el.selectionEnd);
          }
          return getSelection()?.toString() ?? '';
        }
      });
      return (res?.result as string) || '';
    } catch {
      return '';
    }
  }

  /** 在网页右下角闪一个小提示；Chrome 自己的页面放不了，就返回 false */
  async function toast(tabId: number | undefined, text: string, ok: boolean): Promise<boolean> {
    if (tabId === undefined) return false;
    try {
      await browser.scripting.executeScript({
        target: { tabId },
        args: [text, ok],
        func: (text: string, ok: boolean) => {
          document.getElementById('hutong-toast')?.remove();
          const host = document.createElement('div');
          host.id = 'hutong-toast';
          host.dataset.ok = String(ok);
          const box = document.createElement('div');
          box.textContent = (ok ? '✓ ' : '') + text;
          box.style.cssText = 'position:fixed;right:20px;bottom:20px;z-index:2147483647;max-width:340px;padding:12px 16px;border-radius:12px;'
            + 'font:15px/1.5 system-ui,"Microsoft YaHei",sans-serif;color:#fff;box-shadow:0 6px 24px rgba(0,0,0,.25);'
            + 'background:' + (ok ? '#16a34a' : '#b45309');
          host.attachShadow({ mode: 'open' }).appendChild(box);
          document.documentElement.appendChild(host);
          setTimeout(() => host.remove(), ok ? 2500 : 6000);
        }
      });
      return true;
    } catch {
      return false;
    }
  }

  function notify(msg: Extract<ToBg, { type: 'notify' }>) {
    const id = msg.kind === 'image' && msg.itemId ? 'img:' + msg.itemId : 'txt:' + Date.now();
    const base = { iconUrl: '/icon/128.png', title: msg.title, message: msg.message };
    const opt = msg.imageUrl ? { ...base, type: 'image' as const, imageUrl: msg.imageUrl } : { ...base, type: 'basic' as const };
    browser.notifications.create(id, opt).catch(() => browser.notifications.create(id, { ...base, type: 'basic' }));
  }

  // 点通知：照片 → 弹一个小窗口复制（新窗口有焦点，Chrome 才允许放图片进剪贴板）；文字 → 打开侧边栏
  browser.notifications.onClicked.addListener(async (id) => {
    void browser.notifications.clear(id);
    if (id.startsWith('img:')) {
      await browser.windows.create({ url: '/copyimg.html?id=' + encodeURIComponent(id.slice(4)), type: 'popup', width: 300, height: 150, focused: true });
      return;
    }
    try {
      const w = await browser.windows.getLastFocused();
      if (w.id !== undefined) await browser.sidePanel.open({ windowId: w.id });
    } catch { /* 打不开就算了 */ }
  });

  /** 存进 Chrome 的下载文件夹里的「Tapaste」；个别系统不认中文文件名，就退回英文文件名 */
  async function saveFile(url: string, filename: string, fallbackName: string): Promise<SavedInfo> {
    const opt = { url, conflictAction: 'uniquify' as const, saveAs: false };
    try {
      return await waitDownload(await browser.downloads.download({ ...opt, filename: 'Tapaste/' + filename }));
    } catch (e) {
      try {
        return await waitDownload(await browser.downloads.download({ ...opt, filename: 'Tapaste/' + fallbackName }));
      } catch (e2) {
        return { ok: false, detail: `存不进去：${(e as Error).message} / ${(e2 as Error).message}` };
      }
    }
  }

  function waitDownload(id: number, ms = 20000): Promise<SavedInfo> {
    return new Promise((resolve) => {
      let done = false;
      const finish = async (r: SavedInfo) => {
        if (done) return;
        done = true;
        clearTimeout(tm);
        browser.downloads.onChanged.removeListener(on);
        if (r.ok) { const [it] = await browser.downloads.search({ id }); r.path = it?.filename; }
        resolve({ downloadId: id, ...r });
      };
      const tm = setTimeout(() => void finish({ ok: false, detail: '20 秒还没存完' }), ms);
      const check = (st?: string, err?: string, danger?: string) => {
        if (st === 'complete') void finish({ ok: true });
        else if (st === 'interrupted') void finish({ ok: false, detail: '保存被中断：' + (err || '未知原因') });
        else if (danger && !['safe', 'accepted'].includes(danger)) void finish({ ok: false, detail: `Chrome 拦下了这次保存（${danger}）` });
      };
      const look = () => browser.downloads.search({ id }).then(([it]) => it && check(it.state, it.error, it.danger));
      const on = (d: { id: number }) => { if (d.id === id) void look(); };
      browser.downloads.onChanged.addListener(on);
      void look();
    });
  }
});
