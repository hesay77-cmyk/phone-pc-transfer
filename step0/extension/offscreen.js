// 看不见的小页面：保持「等手机来连」、和手机直连、把收到的文字写进剪贴板。
// 第 0 步测试版：所有状态都在内存里，侧边栏打开时来取。

const $ = (id) => document.getElementById(id);
const rand = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => 'abcdefghijkmnpqrstuvwxyz23456789'[b % 32]).join('');

const state = {
  room: localStorage.getItem('room') || (() => { const r = rand(16); localStorage.setItem('room', r); return r; })(),
  startedAt: Date.now(),
  broker: null,
  brokerOk: false,
  mqttReconnects: 0,
  peer: 'none', // none | connecting | connected
  link: null, // 连接方式说明
  connectMs: null,
  connectCount: 0,
  items: [], // {id, from, kind:'text'|'image', text, dataUrl, size, w, h, time, copy}
  results: {}, // key -> {ok, detail, time}
  log: [],
  unacked: [] // 发给手机但手机还没回「收到」的，重连后补发
};

function log(s) {
  state.log.unshift(new Date().toLocaleTimeString() + '  ' + s);
  if (state.log.length > 80) state.log.length = 80;
  push();
}
function result(key, ok, detail) {
  state.results[key] = { ok, detail, time: Date.now() };
  push();
}
function push() {
  chrome.runtime.sendMessage({ to: 'panel', type: 'state', state }).catch(() => {});
}

// ---------------- 介绍人（测试阶段借用公共 MQTT） ----------------
let client = null;
const topic = () => CONFIG.TOPIC_PREFIX + state.room;

function connectBroker(i = 0) {
  const url = CONFIG.BROKERS[i % CONFIG.BROKERS.length];
  state.broker = url;
  log('连接介绍服务：' + url);
  const c = mqtt.connect(url, {
    clientId: 'pc-' + rand(10),
    keepalive: 30,
    reconnectPeriod: 3000,
    connectTimeout: 8000,
    clean: true
  });
  let everConnected = false;
  const giveUp = setTimeout(() => {
    if (!everConnected) {
      log('介绍服务连不上，换下一个');
      c.end(true);
      connectBroker(i + 1);
    }
  }, 10000);
  c.on('connect', () => {
    everConnected = true;
    clearTimeout(giveUp);
    client = c;
    state.brokerOk = true;
    c.subscribe(topic());
    publish({ type: 'pc-online' });
    log('介绍服务已连上');
  });
  c.on('reconnect', () => { if (everConnected) state.mqttReconnects++; });
  c.on('offline', () => { state.brokerOk = false; push(); });
  c.on('message', (t, buf) => {
    if (t !== topic()) return;
    let m;
    try { m = JSON.parse(buf.toString()); } catch { return; }
    if (m.from !== 'phone') return;
    onSignal(m);
  });
}
function publish(obj) {
  if (client) client.publish(topic(), JSON.stringify({ from: 'pc', ...obj }));
}

// ---------------- 直连（WebRTC） ----------------
let pc = null, dc = null, curSid = null, t0 = 0;

function waitIce(p, ms) {
  return new Promise((res) => {
    if (p.iceGatheringState === 'complete') return res();
    const tm = setTimeout(res, ms);
    p.addEventListener('icegatheringstatechange', () => {
      if (p.iceGatheringState === 'complete') { clearTimeout(tm); res(); }
    });
  });
}

async function onSignal(m) {
  if (m.type === 'hello') {
    // 同一次连接的重复招呼：手机可能没收到上一次的回应，把回应再发一遍，不要从头来
    if (m.sid === curSid && pc && pc.localDescription && state.peer !== 'none') {
      publish({ type: 'offer', sid: curSid, sdp: pc.localDescription.sdp });
      return;
    }
    log('手机来连了，开始直连');
    await startOffer(m.sid);
  } else if (m.type === 'answer' && m.sid === curSid && pc) {
    try {
      await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp });
    } catch (e) { log('对方回应出错：' + e.message); }
  }
}

async function startOffer(sid) {
  if (pc) { try { pc.close(); } catch {} }
  curSid = sid;
  t0 = performance.now();
  state.peer = 'connecting';
  push();
  pc = new RTCPeerConnection({ iceServers: CONFIG.ICE_SERVERS });
  const myPc = pc;
  dc = pc.createDataChannel('data', { ordered: true });
  setupChannel(dc, myPc);
  pc.onconnectionstatechange = () => {
    if (myPc !== pc) return;
    log('连接状态：' + myPc.connectionState);
    if (myPc.connectionState === 'failed') {
      state.peer = 'none';
      if (myPc.opened) {
        // 连上过又断了：多半是手机切到别的 App 或锁屏，iPhone 会暂停网页。不算连不上。
        log('直连断了：手机可能切到别的 App 或锁屏了，回到网页会自动重连');
      } else {
        result('connect', false, '连不上：可能这个 Wi-Fi 不让设备互相连');
      }
    }
    if (['disconnected', 'closed'].includes(myPc.connectionState)) { state.peer = 'none'; push(); }
  };
  const offer = await pc.createOffer();
  await pc.setLocalDescription(offer);
  await waitIce(pc, 2500);
  publish({ type: 'offer', sid, sdp: pc.localDescription.sdp });
}

function isPrivate(ip) {
  return /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fd|fc)/i.test(ip || '') || /\.local$/.test(ip || '');
}

async function describeLink(p) {
  try {
    const stats = await p.getStats();
    let pair = null;
    stats.forEach((s) => {
      if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId);
    });
    if (!pair) stats.forEach((s) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    if (!pair) return { lan: null, text: '看不到连接方式' };
    const l = stats.get(pair.localCandidateId) || {}, r = stats.get(pair.remoteCandidateId) || {};
    const types = (l.candidateType || '?') + ' / ' + (r.candidateType || '?');
    if (l.candidateType === 'relay' || r.candidateType === 'relay') return { lan: false, text: '经中转（' + types + '）' };
    const lan = l.candidateType === 'host' || isPrivate(l.address) || isPrivate(r.address);
    return { lan, text: (lan ? '局域网直连' : '经公网打洞，不是局域网') + '（' + types + '）' };
  } catch (e) {
    return { lan: null, text: '读连接方式出错：' + e.message };
  }
}

// 收图片用
let incoming = null;

let resent = 0, lastSeen = 0;
// 心跳：手机锁屏后连接不会马上断，靠心跳发现「其实已经断了」
setInterval(() => {
  if (dc && dc.readyState === 'open') {
    sendJson({ t: 'ping' });
    if (Date.now() - lastSeen > 15000 && state.peer === 'connected') {
      log('15 秒没收到手机的心跳，当作已断开');
      state.peer = 'none';
      try { pc.close(); } catch {}
      push();
    }
  }
}, 5000);

function setupChannel(ch, myPc) {
  ch.binaryType = 'arraybuffer';
  ch.onopen = async () => {
    myPc.opened = true;
    state.peer = 'connected';
    state.connectMs = Math.round(performance.now() - t0);
    state.connectCount++;
    const link = await describeLink(myPc);
    state.link = link.text;
    log('已直连手机，用时 ' + state.connectMs + ' 毫秒，' + link.text);
    result('connect', link.lan !== false, link.text + '，用时 ' + state.connectMs + ' 毫秒');
    // 手机还没确认收到的，现在补发（手机按编号去重）
    const q = state.unacked.slice();
    q.forEach((it) => sendJson({ t: 'text', id: it.id, text: it.text }));
    if (q.length) {
      log('补发了 ' + q.length + ' 条手机还没收到的');
      resent += q.length;
    }
    lastSeen = Date.now();
  };
  ch.onclose = () => { if (myPc === pc) { state.peer = 'none'; log('和手机的直连断开了'); } };
  ch.onmessage = (ev) => {
    lastSeen = Date.now();
    if (typeof ev.data === 'string') {
      let m;
      try { m = JSON.parse(ev.data); } catch { return; }
      onData(m);
    } else if (incoming) {
      incoming.parts.push(ev.data);
      incoming.got += ev.data.byteLength;
    }
  };
}

function sendJson(o) {
  if (dc && dc.readyState === 'open') { dc.send(JSON.stringify(o)); return true; }
  return false;
}

async function onData(m) {
  if (m.t === 'ping') return;
  if (m.t === 'probe') { sendJson({ t: 'probe-ok' }); return; } // 手机切回来时问「你还在吗」
  if (m.t === 'ack') {
    const i = state.unacked.findIndex((x) => x.id === m.id);
    if (i >= 0) {
      const it = state.unacked.splice(i, 1)[0];
      const item = state.items.find((x) => x.id === m.id);
      if (item) item.acked = true;
      if (resent > 0) result('queue', true, '手机重新打开后，补发的内容收到了');
      log('手机确认收到：' + it.text.slice(0, 20));
      push();
    }
    return;
  }
  if (m.t === 'text' || m.t === 'img-end') sendJson({ t: 'ack', id: m.id });
  if (m.t === 'text') {
    const item = { id: m.id, from: 'phone', kind: 'text', text: m.text, time: Date.now() };
    addItem(item);
    item.copy = await copyText(m.text);
    log('收到文字（' + m.text.length + ' 字），自动复制：' + item.copy.summary);
    result('clipText', item.copy.ok, item.copy.summary + '。请到终端里按 Ctrl+V 确认');
    notify('已复制到剪贴板', m.text.slice(0, 80));
    push();
  } else if (m.t === 'img-start') {
    incoming = { meta: m, parts: [], got: 0, t: performance.now() };
  } else if (m.t === 'img-end' && incoming) {
    const { meta, parts, t } = incoming;
    incoming = null;
    const blob = new Blob(parts, { type: meta.mime || 'image/jpeg' });
    const ms = Math.round(performance.now() - t);
    const dataUrl = await blobToDataUrl(blob);
    const item = { id: meta.id, from: 'phone', kind: 'image', dataUrl, size: blob.size, w: meta.w, h: meta.h, name: meta.name, mime: blob.type, time: Date.now(), ms };
    addItem(item);
    item.copy = await copyImage(blob, dataUrl);
    log('收到图片 ' + kb(blob.size) + '，' + (meta.w || '?') + '×' + (meta.h || '?') + '，传输用时 ' + ms + ' 毫秒；自动复制：' + item.copy.summary);
    // 用 blob 网址交给 Chrome 保存（比 data 网址正规，大图也不会超长）
    const blobUrl = URL.createObjectURL(blob);
    item.saved = await chrome.runtime.sendMessage({ to: 'bg', type: 'save-image', url: blobUrl, filename: photoName(blob.type), asciiName: photoName(blob.type, true) })
      .catch((e) => ({ ok: false, detail: '存不进去：' + e.message }));
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
    log(item.saved.ok ? '已存到电脑：' + item.saved.path : '自动保存失败：' + item.saved.detail);
    result('saveImg', item.saved.ok, item.saved.ok ? '已存到 ' + item.saved.path : item.saved.detail);
    result('imgTransfer', blob.size === meta.size, '收到 ' + kb(blob.size) + '（手机那边是 ' + kb(meta.size) + '），' + (meta.w || '?') + '×' + (meta.h || '?') + '，用时 ' + ms + ' 毫秒');
    result('clipImg', item.copy.ok, item.copy.summary + '。请在 AI 聊天框里按 Ctrl+V 确认');
    notify(item.saved.ok ? '收到一张图片，已存进「下载\\互传」' : '收到一张图片', kb(blob.size) + '，点这里打开侧边栏', dataUrl);
    push();
  } else if (m.t === 'hello-info') {
    log('手机信息：' + m.ua);
  }
}

function photoName(mime, ascii) {
  const d = new Date(), p = (n) => String(n).padStart(2, '0');
  const ext = { 'image/png': 'png', 'image/heic': 'heic', 'image/gif': 'gif', 'image/webp': 'webp' }[mime] || 'jpg';
  const day = `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, time = `${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return ascii ? `phone-photo-${day}-${time}.${ext}` : `手机照片 ${day} ${time}.${ext}`;
}

function addItem(item) {
  state.items.unshift(item);
  if (state.items.length > 20) state.items.length = 20;
  push();
}

function notify(title, message, image) {
  chrome.runtime.sendMessage({ to: 'bg', type: 'notify', title, message, image }).catch(() => {});
}

const kb = (n) => (n > 1048576 ? (n / 1048576).toFixed(2) + ' MB' : Math.round(n / 1024) + ' KB');
function blobToDataUrl(b) {
  return new Promise((res) => { const r = new FileReader(); r.onload = () => res(r.result); r.readAsDataURL(b); });
}

// ---------------- 写剪贴板：两种方法都试，记下哪种成功 ----------------
// 后台页面里有的写法会一直卡着不返回，最多等 2 秒
const withTimeout = (p, ms = 2000) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('超过 ' + ms / 1000 + ' 秒没反应')), ms))]);
async function copyText(text) {
  const tried = [];
  try {
    await withTimeout(navigator.clipboard.writeText(text));
    return { ok: true, method: 'A', summary: '成功（方法 A：clipboard API）' };
  } catch (e) { tried.push('A 失败：' + e.message); }
  try {
    const ta = $('ta');
    ta.value = text;
    ta.select();
    if (document.execCommand('copy')) return { ok: true, method: 'B', summary: '成功（方法 B：execCommand）', tried };
    tried.push('B 返回失败');
  } catch (e) { tried.push('B 出错：' + e.message); }
  return { ok: false, summary: '失败：' + tried.join('；') };
}

async function toPng(blob) {
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(bmp.width, bmp.height);
  cv.getContext('2d').drawImage(bmp, 0, 0);
  return cv.convertToBlob({ type: 'image/png' });
}

async function copyImage(blob, dataUrl) {
  const tried = [];
  try {
    const png = await toPng(blob);
    await withTimeout(navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]));
    return { ok: true, method: 'A', summary: '成功（方法 A：clipboard API）' };
  } catch (e) { tried.push('A 失败：' + e.message); }
  try {
    const box = $('imgbox');
    box.innerHTML = '';
    const img = new Image();
    img.src = dataUrl;
    box.appendChild(img);
    await withTimeout(img.decode(), 2000).catch(() => {});
    const range = document.createRange();
    range.selectNode(img);
    const sel = getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    const ok = document.execCommand('copy');
    sel.removeAllRanges();
    if (ok) return { ok: true, method: 'B', summary: '可能成功（方法 B：execCommand，要实际粘贴看看）', tried };
    tried.push('B 返回失败');
  } catch (e) { tried.push('B 出错：' + e.message); }
  return { ok: false, summary: '失败：' + tried.join('；') };
}

// ---------------- 和侧边栏、后台的对话 ----------------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.to !== 'offscreen') return;
  if (msg.type === 'get-state') { sendResponse(state); return; }
  if (msg.type === 'result') { result(msg.key, msg.ok, msg.detail); return; }
  if (msg.type === 'send-text') {
    const it = { id: rand(8), from: 'pc', kind: 'text', text: msg.text, time: Date.now() };
    addItem(it);
    state.unacked.push(it);
    if (state.peer === 'connected' && sendJson({ t: 'text', id: it.id, text: it.text })) {
      log('已发到手机，等手机确认');
      sendResponse({ sent: true });
    } else {
      log('手机现在没连着，先攒着，手机打开网页时自动补发');
      sendResponse({ sent: false, queued: true });
    }
    push();
    return;
  }
  if (msg.type === 'reset-room') {
    if (client) client.unsubscribe(topic());
    state.room = rand(16);
    localStorage.setItem('room', state.room);
    if (pc) { try { pc.close(); } catch {} }
    state.peer = 'none';
    if (client) { client.subscribe(topic()); publish({ type: 'pc-online' }); }
    log('换了新的配对码，旧手机需要重新扫码');
    sendResponse(state);
    return;
  }
});

// 每分钟记一次心跳，用来看后台会不会被浏览器休眠
setInterval(() => { state.lastBeat = Date.now(); push(); }, 60000);

connectBroker(0);
log('后台已启动');
