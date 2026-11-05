// 后台：浏览器只让它做的几件事——开引擎页面、弹通知、存文件、开小窗口。

import { browser } from 'wxt/browser';
import { defineBackground } from 'wxt/utils/define-background';
import type { SavedInfo, ToBg } from '../lib/types';

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
    }
  });

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

  /** 存进 Chrome 的下载文件夹里的「互传」；个别系统不认中文文件名，就退回英文名 */
  async function saveFile(url: string, filename: string, fallbackName: string): Promise<SavedInfo> {
    const opt = { url, conflictAction: 'uniquify' as const, saveAs: false };
    try {
      return await waitDownload(await browser.downloads.download({ ...opt, filename: '互传/' + filename }));
    } catch (e) {
      try {
        return await waitDownload(await browser.downloads.download({ ...opt, filename: 'hutong/' + fallbackName }));
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
