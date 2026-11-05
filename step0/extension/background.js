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
  if (msg.type === 'save-image') {
    saveImage(msg.url, msg.filename, msg.asciiName).then(sendResponse);
    return true;
  }
  if (msg.type === 'show-file') {
    // 打开资源管理器，并选中这张图
    try { chrome.downloads.show(msg.downloadId); } catch { chrome.downloads.showDefaultFolder(); }
    return;
  }
  if (msg.type === 'notify') {
    const opt = msg.image
      ? { type: 'image', iconUrl: 'icon.png', title: msg.title, message: msg.message || '', imageUrl: msg.image }
      : { type: 'basic', iconUrl: 'icon.png', title: msg.title, message: msg.message || '' };
    // 图片通知的编号带上图片 id，点它时用来复制这张图
    const nid = msg.imageId ? 'img:' + msg.imageId : '';
    chrome.notifications.create(nid, opt, () => {
      if (chrome.runtime.lastError && msg.image) {
        // 有的系统不支持带大图的通知，退回普通通知
        chrome.notifications.create(nid, { type: 'basic', iconUrl: 'icon.png', title: msg.title, message: msg.message || '' });
      }
    });
  }
});

// 测试：点通知能不能直接打开侧边栏
chrome.notifications.onClicked.addListener(async (id) => {
  chrome.notifications.clear(id);
  if (id.startsWith('img:')) {
    // 测试：点图片通知 → 弹一个小窗口（新窗口会拿到焦点，才允许往剪贴板放图片），复制完自己关掉
    const w = 300, h = 150;
    chrome.windows.create({ url: 'copyimg.html?id=' + encodeURIComponent(id.slice(4)), type: 'popup', width: w, height: h, focused: true });
    return;
  }
  try {
    const w = await chrome.windows.getLastFocused();
    await chrome.sidePanel.open({ windowId: w.id });
    report('notifOpen', true, '点通知可以打开侧边栏');
  } catch (e) {
    report('notifOpen', false, '点通知打不开侧边栏：' + e.message);
  }
});

// 收到的图自动存进电脑：Chrome 的「下载」文件夹里的「互传」文件夹
async function saveImage(url, filename, asciiName) {
  const opt = { url, conflictAction: 'uniquify', saveAs: false };
  try {
    return await waitDownload(await chrome.downloads.download({ ...opt, filename: '互传/' + filename }), 20000);
  } catch (e) {
    // 个别系统不认中文文件名，退回英文名再试一次
    try {
      return await waitDownload(await chrome.downloads.download({ ...opt, filename: 'hutong/' + asciiName }), 20000);
    } catch (e2) {
      return { ok: false, detail: '存不进去：' + e.message + ' / ' + e2.message };
    }
  }
}
function waitDownload(id, ms) {
  return new Promise((resolve) => {
    let done = false;
    const finish = async (r) => {
      if (done) return;
      done = true;
      clearTimeout(tm);
      chrome.downloads.onChanged.removeListener(on);
      if (r.ok) {
        const [it] = await chrome.downloads.search({ id });
        r.path = it ? it.filename : '';
      }
      resolve({ id, ...r });
    };
    const tm = setTimeout(() => finish({ ok: false, detail: '20 秒还没存完' }), ms);
    const check = (st, err, danger) => {
      if (st === 'complete') finish({ ok: true });
      if (st === 'interrupted') finish({ ok: false, detail: '保存被中断：' + (err || '未知原因') });
      if (danger && !['safe', 'accepted'].includes(danger)) finish({ ok: false, detail: 'Chrome 拦下了这次保存（' + danger + '）' });
    };
    const on = (d) => {
      if (d.id !== id) return;
      if (d.state || d.danger || d.error) chrome.downloads.search({ id }).then(([it]) => it && check(it.state, it.error, it.danger));
    };
    chrome.downloads.onChanged.addListener(on);
    chrome.downloads.search({ id }).then(([it]) => { if (it) check(it.state, it.error, it.danger); });
  });
}
