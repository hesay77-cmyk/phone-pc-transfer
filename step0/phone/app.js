// 手机测试网页：扫码配对、和电脑直连、粘贴发送、选图发送、记录测试结果。
const $ = (id) => document.getElementById(id);
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');
const standalone = !!(navigator.standalone || matchMedia('(display-mode: standalone)').matches);

// ---------------- 配对码：网址里的 #r=… 或本机存着的 ----------------
let room = null, roomFrom = null;
const fromHash = (location.hash.match(/r=([a-z0-9]+)/) || [])[1];
const fromStore = localStorage.getItem('room');
if (fromHash) { room = fromHash; roomFrom = '网址'; localStorage.setItem('room', room); }
else if (fromStore) { room = fromStore; roomFrom = '本机存储'; }

const results = JSON.parse(sessionStorage.getItem('results') || '{}');
const userChoice = JSON.parse(localStorage.getItem('userChoice') || '{}');
const logs = [];
function log(s) {
  logs.unshift(new Date().toLocaleTimeString() + '  ' + s);
  if (logs.length > 60) logs.length = 60;
  $('log').textContent = logs.join('\n');
}
function result(key, ok, detail) {
  results[key] = { ok, detail };
  sessionStorage.setItem('results', JSON.stringify(results));
  renderChecks();
}

const CHECKS = [
  { key: 'connect', name: '和电脑直接连上', how: '打开网页后自动测。' },
  { key: 'paste', name: '点一下就能读到剪贴板', how: '先在别的 App 里复制一段文字，回来点「粘贴并发送到电脑」。iPhone 会弹一个「粘贴」小按钮，点它。' },
  { key: 'image', name: '选的图是原图', how: '点「选一张图片发送」，选一张照片。下面会显示网页拿到的大小，和「照片」App 里这张图的信息（点 ⓘ）对比。',
    ask: [['imageUser', true, '大小差不多'], ['imageUser', false, '明显变小了']] },
  { key: 'recv', name: '能收到电脑发来的文字', how: '在电脑侧边栏「发到手机」里发一句话。' },
  { key: 'resume', name: '切到别的 App 再回来，能自动重新连上', how: '切到微信待一会儿，再切回这个网页。' },
  { key: 'home', name: '加到主屏幕后还能直接用', how: '点 Safari 底部的分享按钮 →「添加到主屏幕」，然后从桌面上的「互传测试」图标打开，看最上面是不是显示「电脑已直连」。' }
];

function renderChecks() {
  $('checks').innerHTML = CHECKS.map((c) => {
    const r = results[c.key];
    let res = r ? `<span class="${r.ok ? 'ok' : 'bad'}">${r.ok ? '✓' : '✗'} ${esc(r.detail)}</span>` : '<span class="wait">还没测</span>';
    if (c.ask) {
      const u = userChoice[c.ask[0][0]];
      if (u !== undefined) res += `<br><span class="${u ? 'ok' : 'bad'}">${u ? '✓' : '✗'} 你说：${esc(c.ask.find((a) => a[1] === u)[2])}</span>`;
    }
    const btns = c.ask ? c.ask.map((a) => `<button class="btn ${userChoice[a[0]] === a[1] ? 'chosen' : ''}" data-k="${a[0]}" data-v="${a[1]}">${esc(a[2])}</button>`).join('') : '';
    return `<li><div class="name">${esc(c.name)}</div><div class="small">${c.how}</div><div class="res">${res}</div>${btns}</li>`;
  }).join('');
}
$('checks').addEventListener('click', (e) => {
  const b = e.target.closest('button[data-k]');
  if (!b) return;
  userChoice[b.dataset.k] = b.dataset.v === 'true';
  localStorage.setItem('userChoice', JSON.stringify(userChoice));
  renderChecks();
});

// ---------------- 状态栏 ----------------
let brokerOk = false, peer = 'none', linkText = '';
function renderStatus() {
  const p = { none: ['wait', '电脑没连上'], connecting: ['wait', '正在连接电脑…'], connected: ['ok', '电脑已直连'], offline: ['bad', '找不到电脑：电脑上的 Chrome 开着吗？'] }[peer];
  $('status').innerHTML =
    `<div><span class="${p[0]}">●</span> <b>${p[1]}</b>${peer === 'connected' && linkText ? '<br><span class="small">' + esc(linkText) + '</span>' : ''}</div>` +
    `<div class="small">介绍服务${brokerOk ? '已连上' : '没连上'} · ${standalone ? '主屏幕模式' : '浏览器模式'}${room ? ' · 配对码来自' + roomFrom : ''}</div>`;
}

// ---------------- 介绍人（测试阶段借用公共 MQTT） ----------------
let client = null, mySid = null, helloTimer = null, helloCount = 0;
const topic = () => CONFIG.TOPIC_PREFIX + room;
function publish(o) { if (client && client.connected) client.publish(topic(), JSON.stringify({ from: 'phone', ...o })); }

function connectBroker(i = 0) {
  const url = CONFIG.BROKERS[i % CONFIG.BROKERS.length];
  log('连接介绍服务：' + url);
  const c = mqtt.connect(url, { clientId: 'ph-' + rand(10), keepalive: 30, reconnectPeriod: 3000, connectTimeout: 8000 });
  let ever = false;
  const giveUp = setTimeout(() => { if (!ever) { log('介绍服务连不上，换下一个'); c.end(true); connectBroker(i + 1); } }, 10000);
  c.on('connect', () => {
    ever = true; clearTimeout(giveUp); client = c; brokerOk = true; renderStatus();
    c.subscribe(topic());
    log('介绍服务已连上');
    startHello();
  });
  c.on('offline', () => { brokerOk = false; renderStatus(); });
  c.on('message', (t, buf) => {
    let m; try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.from !== 'pc') return;
    if (m.type === 'pc-online' && peer !== 'connected') startHello();
    if (m.type === 'offer' && m.sid === mySid) onOffer(m.sdp);
  });
}

let connectT0 = 0;
function startHello() {
  if (peer === 'connected') return;
  mySid = rand(8);
  helloCount = 0;
  connectT0 = performance.now();
  peer = 'connecting'; renderStatus();
  clearInterval(helloTimer);
  const say = () => {
    if (peer === 'connected') { clearInterval(helloTimer); return; }
    helloCount++;
    if (helloCount > 4) { peer = 'offline'; renderStatus(); }
    publish({ type: 'hello', sid: mySid });
  };
  say();
  helloTimer = setInterval(say, 4000);
}

// ---------------- 直连（WebRTC） ----------------
let pc = null, dc = null;
function waitIce(p, ms) {
  return new Promise((res) => {
    if (p.iceGatheringState === 'complete') return res();
    const tm = setTimeout(res, ms);
    p.addEventListener('icegatheringstatechange', () => { if (p.iceGatheringState === 'complete') { clearTimeout(tm); res(); } });
  });
}
let gotOfferFor = null, connectGuard = null;
async function onOffer(sdp) {
  if (gotOfferFor === mySid) return; // 同一次连接只处理一次回应
  gotOfferFor = mySid;
  clearInterval(helloTimer);
  clearTimeout(connectGuard);
  connectGuard = setTimeout(() => { if (peer !== 'connected') { log('15 秒没连上，重来一次'); startHello(); } }, 15000);
  log('电脑回应了，开始直连');
  if (pc) { try { pc.close(); } catch {} }
  pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
  const myPc = pc;
  pc.ondatachannel = (ev) => setupChannel(ev.channel, myPc);
  pc.onconnectionstatechange = () => {
    if (myPc !== pc) return;
    log('连接状态：' + myPc.connectionState);
    if (myPc.connectionState === 'failed') {
      peer = 'none'; renderStatus();
      // 连上过又断了（比如切到别的 App 再回来）不算连不上
      if (myPc.opened) log('直连断了，回到这个网页会自动重连');
      else result('connect', false, '连不上：可能这个 Wi-Fi 不让设备互相连');
    }
  };
  await pc.setRemoteDescription({ type: 'offer', sdp });
  const ans = await pc.createAnswer();
  await pc.setLocalDescription(ans);
  await waitIce(pc, 2500);
  publish({ type: 'answer', sid: mySid, sdp: pc.localDescription.sdp });
}

function isPrivate(ip) { return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fd|fc)/i.test(ip || '') || /\.local$/.test(ip || ''); }
async function describeLink(p) {
  try {
    const stats = await p.getStats();
    let pair = null;
    stats.forEach((s) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
    if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    if (!pair) return { lan: null, text: '看不到连接方式' };
    const l = stats.get(pair.localCandidateId) || {}, r = stats.get(pair.remoteCandidateId) || {};
    const types = (l.candidateType || '?') + ' / ' + (r.candidateType || '?');
    if (l.candidateType === 'relay' || r.candidateType === 'relay') return { lan: false, text: '经中转（' + types + '）' };
    const lan = l.candidateType === 'host' || isPrivate(l.address) || isPrivate(r.address);
    return { lan, text: (lan ? '局域网直连' : '经公网打洞，不是局域网') + '（' + types + '）' };
  } catch (e) { return { lan: null, text: '读连接方式出错：' + e.message }; }
}

let wasHidden = false, hiddenAt = 0;
function setupChannel(ch, myPc) {
  dc = ch;
  ch.binaryType = 'arraybuffer';
  ch.bufferedAmountLowThreshold = 256 * 1024;
  ch.onopen = async () => {
    myPc.opened = true;
    peer = 'connected';
    clearInterval(helloTimer);
    const ms = Math.round(performance.now() - connectT0);
    const link = await describeLink(myPc);
    linkText = link.text + '，用时 ' + ms + ' 毫秒';
    renderStatus();
    log('已直连电脑：' + linkText);
    result('connect', link.lan !== false, linkText);
    if (standalone) result('home', true, '主屏幕模式下连上了，配对码来自' + roomFrom);
    if (wasHidden) {
      result('resume', true, '切回来后 ' + ((Date.now() - hiddenAt) / 1000).toFixed(1) + ' 秒内重新连上');
      wasHidden = false;
    }
    ch.send(JSON.stringify({ t: 'hello-info', ua: navigator.userAgent + (standalone ? '（主屏幕）' : '') }));
  };
  ch.onclose = () => { if (dc === ch) { peer = 'none'; renderStatus(); log('和电脑的直连断开了'); } };
  ch.onmessage = (ev) => {
    if (typeof ev.data !== 'string') return;
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.t === 'ping') { sendJson({ t: 'ping' }); return; }
    if (m.t === 'ack') { onAck(m.id); return; }
    if (m.t === 'text') { sendJson({ t: 'ack', id: m.id }); onText(m); }
  };
}

// 电脑可能补发同一条，按编号去重
const seen = new Set(JSON.parse(localStorage.getItem('seen') || '[]'));
const waiting = new Map(); // 发给电脑、还没确认的
function onAck(id) {
  const w = waiting.get(id);
  if (!w) return;
  clearTimeout(w.timer);
  waiting.delete(id);
  $('progress').innerHTML = '<span class="ok">电脑已收到' + (w.what ? '（' + w.what + '）' : '') + '</span>';
}
function track(id, what) {
  waiting.set(id, { what, timer: setTimeout(() => {
    if (waiting.has(id)) { waiting.delete(id); $('progress').innerHTML = '<span class="bad">电脑没回应，可能没收到，请再发一次</span>'; }
  }, 8000) });
}
function onText(m) {
  if (seen.has(m.id)) return;
  seen.add(m.id);
  localStorage.setItem('seen', JSON.stringify([...seen].slice(-200)));
  if (!$('items').dataset.has) { $('items').innerHTML = ''; $('items').dataset.has = '1'; }
  const d = document.createElement('div');
  d.className = 'item';
  const isUrl = /^https?:\/\/\S+$/.test(m.text.trim());
  d.innerHTML = `<div class="meta">${new Date().toLocaleTimeString()}</div><div class="text"></div>` +
    (isUrl ? `<a class="btn" href="${esc(m.text.trim())}" target="_blank">打开网址</a>` : '') + `<button class="btn">复制</button>`;
  d.querySelector('.text').textContent = m.text;
  d.querySelector('button').onclick = async (e) => {
    try { await navigator.clipboard.writeText(m.text); e.target.textContent = '已复制'; } catch (err) { e.target.textContent = '复制失败'; }
  };
  $('items').prepend(d);
  log('收到电脑发来的文字（' + m.text.length + ' 字）');
  result('recv', true, '收到了：' + m.text.slice(0, 20));
}

// ---------------- 发送 ----------------
function sendJson(o) {
  if (dc && dc.readyState === 'open') { dc.send(JSON.stringify(o)); return true; }
  return false;
}
function needConn() {
  if (dc && dc.readyState === 'open') return true;
  $('progress').innerHTML = '<span class="bad">还没连上电脑，等上面显示「电脑已直连」再发</span>';
  return false;
}

$('paste').onclick = async () => {
  let text;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    result('paste', false, '读不到剪贴板：' + e.message);
    $('progress').innerHTML = '<span class="bad">读不到剪贴板，可以在下面框里长按粘贴再发送</span>';
    return;
  }
  if (!text) { result('paste', false, '剪贴板是空的'); return; }
  result('paste', true, '读到了 ' + text.length + ' 个字');
  if (!needConn()) return;
  const id = rand(8);
  sendJson({ t: 'text', id, text });
  track(id, text.length + ' 个字');
  $('progress').textContent = '已发出 ' + text.length + ' 个字…';
};

$('sendTxt').onclick = () => {
  const text = $('txt').value;
  if (!text.trim() || !needConn()) return;
  const id = rand(8);
  sendJson({ t: 'text', id, text });
  track(id, text.length + ' 个字');
  $('txt').value = '';
  $('progress').textContent = '已发出…';
};

$('pick').onclick = () => $('file').click();
$('file').onchange = async () => {
  const f = $('file').files[0];
  $('file').value = '';
  if (!f) return;
  let w = null, h = null;
  try { const bmp = await createImageBitmap(f); w = bmp.width; h = bmp.height; } catch {}
  result('image', true, `网页拿到：${kb(f.size)}，${w || '?'}×${h || '?'}，格式 ${f.type || '未知'}`);
  if (!needConn()) return;
  const id = rand(8);
  sendJson({ t: 'img-start', id, name: f.name, size: f.size, mime: f.type, w, h });
  const buf = await f.arrayBuffer();
  const t0 = performance.now();
  for (let off = 0; off < buf.byteLength; off += CONFIG.CHUNK) {
    if (dc.bufferedAmount > 1024 * 1024) await new Promise((r) => { dc.onbufferedamountlow = () => { dc.onbufferedamountlow = null; r(); }; });
    dc.send(buf.slice(off, off + CONFIG.CHUNK));
    $('progress').textContent = '发送中 ' + Math.round((off / buf.byteLength) * 100) + '%';
  }
  sendJson({ t: 'img-end', id });
  track(id, `${kb(f.size)}，用时 ${Math.round(performance.now() - t0)} 毫秒`);
  $('progress').textContent = '已发出，等电脑确认…';
  log('发送图片 ' + kb(f.size));
};

// ---------------- 切到后台再回来 ----------------
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { wasHidden = true; hiddenAt = Date.now(); return; }
  if (!client) return;
  setTimeout(() => {
    if (!(dc && dc.readyState === 'open')) { log('切回来了，重新连接电脑'); peer = 'none'; startHello(); }
    else if (wasHidden) { result('resume', true, '切回来时连接还在'); wasHidden = false; }
  }, 600);
});

// ---------------- 复制测试结果 ----------------
$('report').onclick = async () => {
  const lines = ['【互传第 0 步 · 手机网页测试结果】', '手机：' + navigator.userAgent, '模式：' + (standalone ? '主屏幕' : '浏览器') + '，配对码来自' + (roomFrom || '无'), ''];
  CHECKS.forEach((c, i) => {
    const r = results[c.key];
    let s = r ? (r.ok ? '✓ ' : '✗ ') + r.detail : '还没测';
    if (c.ask && userChoice[c.ask[0][0]] !== undefined) s += ' ｜ 你说：' + c.ask.find((a) => a[1] === userChoice[c.ask[0][0]])[2];
    lines.push(`${i + 1}. ${c.name}：${s}`);
  });
  lines.push('', '运行记录：', ...logs.slice(0, 25));
  try {
    await navigator.clipboard.writeText(lines.join('\n'));
    $('reportTip').textContent = '已复制，去和 Claude 的对话里粘贴就行';
  } catch (e) {
    $('reportTip').textContent = '复制失败，请截图发给 Claude';
  }
};

renderStatus();
renderChecks();
if (!room) { $('nopair').hidden = false; $('status').innerHTML = '<span class="bad">还没配对</span>'; }
else connectBroker(0);
