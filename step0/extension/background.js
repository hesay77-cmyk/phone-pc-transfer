// 后台：负责开「看不见的小页面」(offscreen)、弹通知、打开侧边栏。
// 真正的连接和写剪贴板都在 offscreen.js 里，因为后台这里做不了。

async function ensureOffscreen() {
  try {
    if (await chrome.offscreen.hasDocument()) return;
    await chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WEB_RTC', 'CLIPBOARD'],
      justification: '保持和手机的直连，并把手机发来的文字写进剪贴板'
    });
  } catch (e) {
    if (!String(e).includes('single offscreen')) console.warn('offscreen', e);
  }
}

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch(() => {});
  ensureOffscreen();
});
chrome.runtime.onStartup.addListener(ensureOffscreen);
ensureOffscreen();

function report(key, ok, detail) {
  chrome.runtime.sendMessage({ to: 'offscreen', type: 'result', key, ok, detail }).catch(() => {});
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.to !== 'bg') return;
  if (msg.type === 'ensure-offscreen') {
    ensureOffscreen().then(() => sendResponse({ ok: true }));
    return true;
  }
  if (msg.type === 'notify') {
    const opt = msg.image
      ? { type: 'image', iconUrl: 'icon.png', title: msg.title, message: msg.message || '', imageUrl: msg.image }
      : { type: 'basic', iconUrl: 'icon.png', title: msg.title, message: msg.message || '' };
    chrome.notifications.create('', opt, () => {
      if (chrome.runtime.lastError && msg.image) {
        // 有的系统不支持带大图的通知，退回普通通知
        chrome.notifications.create('', { type: 'basic', iconUrl: 'icon.png', title: msg.title, message: msg.message || '' });
      }
    });
  }
});

// 测试：点通知能不能直接打开侧边栏
chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  try {
    const w = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: w.id });
    report('notifOpen', true, '点通知可以打开侧边栏');
  } catch (e) {
    report('notifOpen', false, '点通知打不开侧边栏：' + e.message);
  }
});
