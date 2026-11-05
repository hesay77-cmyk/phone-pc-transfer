// 侧边栏：显示配对码、测试清单、收到的东西。状态都从 offscreen 取。
const $ = (id) => document.getElementById(id);
let S = null;
let lastItemsKey = '';
let lastQrRoom = '';
const userChoice = JSON.parse(localStorage.getItem('userChoice') || '{}');

const CHECKS = [
  { key: 'connect', name: '家里 Wi-Fi 下，手机和电脑能直接连上',
    how: '手机扫码打开网页后，这里会自动显示结果。' },
  { key: 'clipText', name: '你在用别的软件时，手机发的字也能自动进剪贴板',
    how: '打开记事本点一下（让 Chrome 不在最前面），再用手机发一段文字，然后在记事本里按 Ctrl+V。',
    ask: [['clipTextUser', true, '能粘贴出来'], ['clipTextUser', false, '粘贴不出来']] },
  { key: 'saveImg', name: '收到的图自动存进电脑',
    how: '手机发一张图过来，点图下面的「打开所在文件夹」，看照片是不是已经在「下载 → 互传」文件夹里。',
    ask: [['saveImgUser', true, '照片在文件夹里'], ['saveImgUser', false, '没找到']] },
  { key: 'notifCopy', name: '点一下「收到图片」的通知，图就复制好了',
    how: '手机发一张图，电脑右下角弹出通知时点它，会闪一下小窗口，然后去 AI 的输入框按 Ctrl+V（看能不能粘出来就行，不用发）。',
    ask: [['notifCopyUser', true, '能粘出图片'], ['notifCopyUser', false, '粘不出来']] },
  { key: 'clipImg', name: '什么都不点，图片也能直接 Ctrl+V',
    how: '手机发一张图，直接去 AI 的输入框按 Ctrl+V。（Chrome 多半不让，粘不出来也正常）',
    ask: [['clipImgUser', true, '能粘贴出图片'], ['clipImgUser', false, '粘贴不出来']] },
  { key: 'dragUser', name: '把图从这里拖进识图网站',
    how: '打开 <a href="https://images.google.com" target="_blank">Google 图片</a> 或 <a href="https://graph.baidu.com" target="_blank">百度识图</a>，把下面「收到的东西」里的图拖过去。',
    ask: [['dragUser', true, '拖进去能识图'], ['dragUser', false, '拖不进去']] },
  { key: 'imgTransfer', name: '图片是原图，没有被压缩',
    how: '手机网页上会显示原图大小，和这里收到的对比。' },
  { key: 'notifOpen', name: '点「收到文字」的通知，能打开这个侧边栏',
    how: '手机发一段文字，右下角弹出通知时点一下它。' },
  { key: 'queue', name: '手机网页没开时，电脑发的东西先攒着',
    how: '先关掉手机网页，在下面「发到手机」发一句话，再打开手机网页，看能不能收到。' },
  { key: 'stayUser', name: '插件在后台放很久也不掉线',
    how: '保持 Chrome 开着，过半小时以上（比如吃完饭回来）再用手机发一次。',
    ask: [['stayUser', true, '过了很久还能收到'], ['stayUser', false, '过一阵就收不到了']] }
];

function call(type, extra = {}) {
  return chrome.runtime.sendMessage({ to: 'offscreen', type, ...extra });
}

async function load() {
  await chrome.runtime.sendMessage({ to: 'bg', type: 'ensure-offscreen' }).catch(() => {});
  for (let i = 0; i < 10; i++) {
    const s = await call('get-state').catch(() => null);
    if (s) { S = s; render(); return; }
    await new Promise((r) => setTimeout(r, 400));
  }
  $('status').innerHTML = '<div class="bad">后台没启动起来，请到 chrome://extensions 里把这个插件关掉再打开。</div>';
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.to === 'panel' && msg.type === 'state') { S = msg.state; render(); }
});

const mins = (ms) => Math.floor(ms / 60000);
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');

function render() {
  if (!S) return;
  const peer = { none: ['wait', '手机没连着'], connecting: ['wait', '正在连接手机…'], connected: ['ok', '手机已直连'] }[S.peer];
  $('status').innerHTML =
    `<div><span class="${S.brokerOk ? 'ok' : 'bad'}">●</span> 介绍服务：${S.brokerOk ? '已连上' : '没连上'}</div>` +
    `<div><span class="${peer[0]}">●</span> ${peer[1]}${S.peer === 'connected' && S.link ? '，' + esc(S.link) : ''}</div>` +
    `<div class="small">后台已运行 ${mins(Date.now() - S.startedAt)} 分钟，介绍服务重连 ${S.mqttReconnects} 次，手机连上过 ${S.connectCount} 次</div>`;

  if (S.room !== lastQrRoom) {
    lastQrRoom = S.room;
    const url = CONFIG.PHONE_URL + '#r=' + S.room;
    const qr = qrcode(0, 'M');
    qr.addData(url);
    qr.make();
    $('qr').innerHTML = qr.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
    $('room').textContent = '配对码 ' + S.room.slice(0, 4) + '…';
  }

  $('checks').innerHTML = CHECKS.map((c) => {
    const auto = S.results[c.key];
    const user = c.ask ? userChoice[c.ask[0][0]] : undefined;
    let res = '<span class="wait">还没测</span>';
    if (auto) res = `<span class="${auto.ok ? 'ok' : 'bad'}">${auto.ok ? '✓' : '✗'} ${esc(auto.detail)}</span>`;
    if (user !== undefined && c.key === c.ask[0][0]) res = `<span class="${user ? 'ok' : 'bad'}">${user ? '✓' : '✗'} 你说：${esc(c.ask.find((a) => a[1] === user)[2])}</span>`;
    else if (user !== undefined) res += `<br><span class="${user ? 'ok' : 'bad'}">${user ? '✓' : '✗'} 你说：${esc(c.ask.find((a) => a[1] === user)[2])}</span>`;
    if (c.key === 'stayUser') res = `<span class="small">现在已运行 ${mins(Date.now() - S.startedAt)} 分钟</span><br>` + res;
    const btns = c.ask ? '<div class="btns">' + c.ask.map((a) =>
      `<button data-k="${a[0]}" data-v="${a[1]}" class="${userChoice[a[0]] === a[1] ? 'chosen' : ''}">${esc(a[2])}</button>`).join('') + '</div>' : '';
    return `<li><div class="name">${esc(c.name)}</div><div class="small">${c.how}</div><div class="res">${res}</div>${btns}</li>`;
  }).join('');

  const key = S.items.map((i) => i.id + (i.acked ? '+' : '') + (i.saved ? 's' : '')).join(',');
  if (key !== lastItemsKey) {
    lastItemsKey = key;
    $('items').innerHTML = S.items.length ? '' : '<p class="small">还没收到东西</p>';
    S.items.forEach((it) => $('items').appendChild(renderItem(it)));
  }

  $('log').textContent = S.log.join('\n');
}

function renderItem(it) {
  const d = document.createElement('div');
  d.className = 'item';
  const who = it.from === 'phone' ? '手机发来' : (it.acked ? '发到手机 · 手机已收到' : '发到手机 · 等手机收');
  const t = new Date(it.time).toLocaleTimeString();
  if (it.kind === 'text') {
    d.innerHTML = `<div class="meta">${who} · ${t}</div><div class="text"></div><button>复制</button>`;
    d.querySelector('.text').textContent = it.text;
    d.querySelector('button').onclick = async (e) => {
      await navigator.clipboard.writeText(it.text);
      e.target.textContent = '已复制';
    };
  } else {
    d.innerHTML = `<div class="meta">${who} · ${t} · ${kb(it.size)} · ${it.w || '?'}×${it.h || '?'}</div>`;
    const img = new Image();
    img.src = it.dataUrl;
    img.draggable = true;
    img.title = '可以直接拖进网页';
    d.appendChild(img);
    const b = document.createElement('button');
    b.textContent = '复制这张图';
    b.onclick = async () => {
      try {
        const blob = await (await fetch(it.dataUrl)).blob();
        const bmp = await createImageBitmap(blob);
        const cv = new OffscreenCanvas(bmp.width, bmp.height);
        cv.getContext('2d').drawImage(bmp, 0, 0);
        const png = await cv.convertToBlob({ type: 'image/png' });
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
        b.textContent = '已复制';
        call('result', { key: 'clipImgButton', ok: true, detail: '在侧边栏点按钮复制图片：成功' });
      } catch (e) {
        b.textContent = '复制失败';
        call('result', { key: 'clipImgButton', ok: false, detail: '在侧边栏点按钮复制图片：失败 ' + e.message });
      }
    };
    d.appendChild(b);
    if (it.saved) {
      const st = document.createElement('div');
      st.className = 'small';
      if (it.saved.ok) {
        st.textContent = '已存到：' + it.saved.path;
        const f = document.createElement('button');
        f.textContent = '打开所在文件夹';
        f.style.marginLeft = '6px';
        f.onclick = () => chrome.runtime.sendMessage({ to: 'bg', type: 'show-file', downloadId: it.saved.id });
        d.appendChild(f);
      } else {
        st.className = 'small bad';
        st.textContent = '没能自动保存：' + it.saved.detail;
      }
      d.appendChild(st);
    }
  }
  return d;
}

$('checks').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  userChoice[b.dataset.k] = b.dataset.v === 'true';
  localStorage.setItem('userChoice', JSON.stringify(userChoice));
  render();
});

$('send').onclick = async () => {
  const text = $('out').value.trim();
  if (!text) return;
  const r = await call('send-text', { text });
  $('sendTip').textContent = r && r.sent ? '已发出' : '手机没连着，先攒着，手机打开网页时自动补发';
  $('out').value = '';
};

$('reset').onclick = async () => {
  if (!confirm('换配对码后，手机要重新扫一次。确定吗？')) return;
  S = await call('reset-room');
  render();
};

$('report').onclick = async () => {
  const lines = ['【互传第 0 步 · 电脑插件测试结果】', '插件版本：' + chrome.runtime.getManifest().version, '浏览器：' + navigator.userAgent, ''];
  CHECKS.forEach((c, i) => {
    const auto = S.results[c.key];
    const user = c.ask ? userChoice[c.ask[0][0]] : undefined;
    let r = auto ? (auto.ok ? '✓ ' : '✗ ') + auto.detail : '还没测';
    if (user !== undefined) r += ' ｜ 你说：' + c.ask.find((a) => a[1] === user)[2];
    lines.push(`${i + 1}. ${c.name}：${r}`);
  });
  if (S.results.clipImgButton) lines.push('附加：' + S.results.clipImgButton.detail);
  lines.push('', `后台运行 ${mins(Date.now() - S.startedAt)} 分钟，介绍服务重连 ${S.mqttReconnects} 次，手机连上过 ${S.connectCount} 次`);
  lines.push('', '运行记录：', ...S.log.slice(0, 30));
  await navigator.clipboard.writeText(lines.join('\n'));
  $('reportTip').textContent = '已复制，去和 Claude 的对话里粘贴就行';
};

setInterval(render, 30000);
document.querySelector('h1 small').textContent = '第 0 步 · 版本 ' + chrome.runtime.getManifest().version;
load();
