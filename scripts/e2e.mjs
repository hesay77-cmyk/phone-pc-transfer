// 端到端自动测试：在本机模拟「电脑插件 + 手机网页」，走真正的 WebRTC 直连。
// 介绍人用本机的 MQTT（aedes），手机网页用本机的小网站。
// 用法：npm run e2e   （需要 Chromium + Playwright；Linux 服务器上用 xvfb-run）

import { execSync } from 'node:child_process';
import { mkdtempSync, readFileSync, existsSync, statSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { extname, join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const aedes = require('aedes')();
const { createServer: createBroker } = require('aedes-server-factory');

const ROOT = new URL('..', import.meta.url).pathname;
const work = mkdtempSync(join(tmpdir(), 'hutong-e2e-'));
const extDir = join(work, 'ext'), mobileDir = join(work, 'mobile');
const env = { ...process.env, VITE_SIGNAL_URLS: 'ws://localhost:8888', VITE_PHONE_URL: 'http://localhost:8080/', VITE_E2E: '1' };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let failures = 0;
const check = (name, ok, detail = '') => { console.log(`${ok ? '✓' : '✗'} ${name}${detail ? '  ' + detail : ''}`); if (!ok) failures++; };

console.log('构建插件和手机网页（指向本机）…');
execSync('npx wxt build', { cwd: join(ROOT, 'apps/extension'), env: { ...env, EXT_OUT_DIR: extDir }, stdio: 'ignore' });
execSync('npx vite build', { cwd: join(ROOT, 'apps/mobile'), env: { ...env, MOBILE_OUT_DIR: mobileDir }, stdio: 'ignore' });
const extPath = join(extDir, 'chrome-mv3');

createBroker(aedes, { ws: true }).listen(8888);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const webPic = testPngLater();
createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  // 模拟一个普通网页（右键「发到手机」用）
  if (p === '/e2e/page.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end('<!doctype html><title>测试网页</title><p id="t">第一行<br>第二行</p><img id="pic" src="/e2e/pic.png">');
  }
  // 模拟一个能收图片的网页：上传区、「选择文件」按钮、输入框、普通文字
  if (p === '/e2e/drop.html') {
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
    return res.end(`<!doctype html><title>收图测试</title>
<div id="zone" style="height:80px;border:1px dashed">拖到这里上传</div>
<label id="pick">选择文件<input id="inp" type="file" accept="image/*" hidden></label>
<div id="ed" contenteditable="true" style="height:40px;border:1px solid">输入框</div>
<p id="plain">普通文字</p>
<script>
  window.log = [];
  const info = (f) => f ? f.arrayBuffer().then((b) => ({ name: f.name, type: f.type, size: b.byteLength, sum: new Uint8Array(b).reduce((a, x) => (a * 31 + x) >>> 0, 7) })) : null;
  const zone = document.getElementById('zone');
  zone.addEventListener('dragenter', (e) => log.push('zone-enter:' + [...e.dataTransfer.types].join('|')));
  zone.addEventListener('dragover', (e) => { if ([...e.dataTransfer.types].includes('Files')) e.preventDefault(); });
  zone.addEventListener('drop', async (e) => { e.preventDefault(); log.push({ where: 'zone', file: await info(e.dataTransfer.files[0]) }); });
  document.getElementById('inp').addEventListener('change', async (e) => log.push({ where: 'input', file: await info(e.target.files[0]) }));
  document.getElementById('ed').addEventListener('paste', async (e) => { const f = e.clipboardData.files[0]; if (f) { e.preventDefault(); log.push({ where: 'paste', file: await info(f) }); } });
  addEventListener('drop', (e) => { if (![...e.dataTransfer.types].includes('Files')) log.push('page-saw-url'); });
</script>`);
  }
  if (p === '/e2e/pic.png') { res.writeHead(200, { 'content-type': 'image/png' }); return res.end(webPic()); }
  if (p.endsWith('/')) p += 'index.html';
  const f = join(mobileDir, p);
  if (!existsSync(f) || !statSync(f).isFile()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[extname(f)] || 'application/octet-stream' });
  res.end(readFileSync(f));
}).listen(8080);

function testPngLater() { let b; return () => (b ??= testPng(400, 300)); }

/** 生成一张 900×700 的 PNG 测试照片（随机像素，压不小） */
function testPng(w = 900, h = 700) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = ~0; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return ~c >>> 0; };
  const chunk = (t, d) => { const len = Buffer.alloc(4); len.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let i = 0; i < raw.length; i++) raw[i] = (i % (w * 3 + 1)) === 0 ? 0 : (Math.random() * 256) | 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}

const ctx = await chromium.launchPersistentContext(join(work, 'profile'), {
  headless: false, args: [`--disable-extensions-except=${extPath}`, `--load-extension=${extPath}`]
});
let [sw] = ctx.serviceWorkers();
if (!sw) sw = await ctx.waitForEvent('serviceworker');
const extId = new URL(sw.url()).host;
const panel = await ctx.newPage();
await panel.goto(`chrome-extension://${extId}/sidepanel.html`);
await panel.waitForSelector('.qr[data-url]', { timeout: 20000 });
const pairUrl = await panel.getAttribute('.qr', 'data-url');
check('插件显示配对二维码', /^http:\/\/localhost:8080\/#k=[A-Za-z0-9_-]{43}$/.test(pairUrl), pairUrl);

const phoneBrowser = await chromium.launch({ headless: false });
const phoneCtx = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 } });
await phoneCtx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: 'http://localhost:8080' });
let phone = await phoneCtx.newPage();
phone.on('pageerror', (e) => console.log('[手机页面出错]', e.message));
const phoneLog = [];
const logPhone = (pg) => pg.on('console', (m) => phoneLog.push(new Date().toISOString().slice(17, 23) + ' ' + m.text()));
logPhone(phone);
const t0 = Date.now();
await phone.goto(pairUrl);
await phone.waitForSelector('.status[data-link="connected"]', { timeout: 20000 });
check('手机扫码后连上电脑', true, `${Date.now() - t0} 毫秒（含打开网页）`);
check('地址栏里的暗号被抹掉', !(await phone.evaluate(() => location.hash)));

// 「放到手机桌面」：看步骤时暗号临时回到网址里（桌面图标存的就是它），收起后再抹掉
await phone.click('button:has-text("怎么放")');
const homeUrl = await phone.evaluate(() => ({ hash: location.hash, man: document.querySelector('link[rel="manifest"]').href }));
const manStart = homeUrl.man.startsWith('data:') ? JSON.parse(decodeURIComponent(homeUrl.man.split(',')[1])).start_url : '';
await phone.click('button:has-text("先收起")');
const afterClose = await phone.evaluate(() => ({ hash: location.hash, man: document.querySelector('link[rel="manifest"]').getAttribute('href') }));
check('放到桌面：看步骤时网址和清单都带暗号，收起后抹掉',
  pairUrl.endsWith(homeUrl.hash) && manStart.endsWith(homeUrl.hash) && !afterClose.hash && afterClose.man === './manifest.webmanifest',
  `${homeUrl.hash.slice(0, 8)}… → 「${afterClose.hash}」`);
await panel.waitForSelector('.status[data-link="connected"]', { timeout: 5000 });
check('电脑显示已连上手机', (await panel.textContent('.status')).includes('已连上'), (await panel.textContent('header')).trim().replace(/\s+/g, ' '));

// 手机打字发到电脑
await phone.fill('textarea', 'echo "你好" && ls');
await phone.getByRole('button', { name: '发送', exact: true }).click();
await panel.waitForSelector('.item[data-kind="text"][data-from="phone"]', { timeout: 5000 });
const meta = await panel.textContent('.item[data-kind="text"] .meta');
check('电脑收到文字并自动复制', meta.includes('已复制'), meta.trim());
await phone.waitForSelector('.sent[data-state="done"]', { timeout: 5000 });
check('手机显示「电脑已收到」', true);

// 手机「粘贴并发送」
await phone.evaluate(() => navigator.clipboard.writeText('从手机剪贴板来的'));
await phone.click('text=粘贴并发送到电脑');
await panel.waitForFunction(() => document.body.innerText.includes('从手机剪贴板来的'), null, { timeout: 5000 });
check('粘贴并发送：电脑收到', true);

// 手机发照片
const png = testPng();
await phone.setInputFiles('input[type=file]', { name: 'IMG_0001.png', mimeType: 'image/png', buffer: png });
await panel.waitForSelector('.item[data-kind="image"] img', { timeout: 15000 });
await panel.waitForFunction(() => document.querySelector('.item[data-kind="image"]')?.innerText.includes('打开所在文件夹'), null, { timeout: 15000 }).catch(() => {});
const imgText = await panel.textContent('.item[data-kind="image"]');
check('电脑收到照片并显示', true, `${(png.length / 1048576).toFixed(2)} MB`);
check('照片自动存进下载文件夹', imgText.includes('打开所在文件夹'), imgText.includes('没能自动保存') ? imgText : '');
const sizeOk = await panel.evaluate(async (n) => {
  const img = document.querySelector('.item[data-kind="image"] img');
  const b = await (await fetch(img.src)).blob();
  return b.size === n;
}, png.length);
check('照片一字节不差', sizeOk);
const swNow = ctx.serviceWorkers()[0] ?? sw;
const notes = await swNow.evaluate(async () => {
  const all = await chrome.notifications.getAll();
  return { ids: Object.keys(all), level: await chrome.notifications.getPermissionLevel() };
}).catch((e) => ({ ids: [], level: String(e) }));
check('弹出文字通知', notes.ids.some((k) => k.startsWith('txt:')), `${notes.level}：${notes.ids.join(', ')}`);
check('弹出照片通知', notes.ids.some((k) => k.startsWith('img:')), `${notes.level}：${notes.ids.join(', ')}`);

// 电脑发到手机
await panel.fill('textarea', 'https://example.com/abc');
await panel.click('button:has-text("发到手机")');
await phone.waitForFunction(() => document.body.innerText.includes('example.com/abc'), null, { timeout: 5000 });
check('电脑发到手机：手机收到网址', await phone.isVisible('text=打开网址'));

// 电脑发图片到手机（侧边栏里选图）
const pcPng = testPng(500, 400);
await panel.setInputFiles('.send input[type=file]', { name: 'screenshot.png', mimeType: 'image/png', buffer: pcPng });
await phone.waitForSelector('.item[data-kind="image"] img', { timeout: 15000 });
const phoneImgOk = await phone.evaluate(async (n) => {
  const b = await (await fetch(document.querySelector('.item[data-kind="image"] img').src)).blob();
  return b.size === n;
}, pcPng.length);
check('电脑发图片到手机：手机显示，一字节不差', phoneImgOk);
check('手机上有「存到相册」', await phone.isVisible('text=存到相册'));

// 截图后：在侧边栏按 Ctrl+V（不用先点输入框），或点「发刚截的图」
const putShot = (w, h) => panel.evaluate(async ([w, h]) => {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  const g = c.getContext('2d'); g.fillStyle = '#e11d48'; g.fillRect(0, 0, w, h);
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': await new Promise((r) => c.toBlob(r, 'image/png')) })]);
}, [w, h]);
const phoneImgs = () => phone.locator('.item[data-kind="image"] img').count();
let nImg = await phoneImgs();
await putShot(320, 200);
await panel.click('h1');
await panel.keyboard.press('Control+V');
await phone.waitForFunction((n) => document.querySelectorAll('.item[data-kind="image"] img').length > n, nImg, { timeout: 10000 })
  .then(() => check('截图后在侧边栏按 Ctrl+V：手机收到', true), () => check('截图后在侧边栏按 Ctrl+V：手机收到', false));
nImg = await phoneImgs();
await putShot(200, 320);
await panel.click('button:has-text("发刚复制的")');
await phone.waitForFunction((n) => document.querySelectorAll('.item[data-kind="image"] img').length > n, nImg, { timeout: 10000 })
  .then(() => check('截图后点「发刚复制的」：手机收到图', true), async () => check('截图后点「发刚复制的」：手机收到图', false, await panel.textContent('.send')));

// 在别的软件里复制了一段代码：点「发刚复制的」，或者按快捷键（Chrome 不在前台也行）
const code1 = 'function hi() {\n  return "你好";\n}';
await panel.evaluate((t) => navigator.clipboard.writeText(t), code1);
await panel.click('button:has-text("发刚复制的")');
await phone.waitForFunction((t) => [...document.querySelectorAll('.item .text')].some((e) => e.textContent === t), code1, { timeout: 5000 })
  .then(() => check('复制代码后点「发刚复制的」：手机收到（换行保留）', true), async () => check('复制代码后点「发刚复制的」：手机收到（换行保留）', false, await panel.textContent('.send')));
const code2 = 'SELECT * FROM t WHERE id = 42;';
await panel.evaluate((t) => navigator.clipboard.writeText(t), code2);
await (ctx.serviceWorkers()[0] ?? sw).evaluate(() => globalThis.__sendClipboard());
await phone.waitForFunction((t) => [...document.querySelectorAll('.item .text')].some((e) => e.textContent === t), code2, { timeout: 5000 })
  .then(() => check('复制后按快捷键：手机收到', true), () => check('复制后按快捷键：手机收到', false));

await sleep(1500);
const stuck = await panel.evaluate(() => [...document.querySelectorAll('.item[data-from="pc"] .meta')].map((e) => e.textContent.trim().replace(/\s+/g, ' ')).filter((t) => t.includes('等手机')));
check('发到手机的都显示「手机已收到」（没有卡在「等手机打开网页」的）', stuck.length === 0, stuck.join(' | '));

// 「复制就发」：只按 Ctrl+C 就到手机；手机发来的字（自动进了剪贴板）不会又被发回手机
await panel.check('.auto input');
await sleep(1000);
const auto1 = '复制就发 ' + Date.now();
await panel.evaluate((t) => navigator.clipboard.writeText(t), auto1);
await phone.waitForFunction((t) => [...document.querySelectorAll('.item .text')].some((e) => e.textContent === t), auto1, { timeout: 5000 })
  .then(() => check('打开「复制就发」后只复制：手机收到', true), () => check('打开「复制就发」后只复制：手机收到', false));
await phone.fill('textarea', '手机发的不该弹回来');
await phone.getByRole('button', { name: '发送', exact: true }).click();
await panel.waitForFunction(() => document.body.innerText.includes('手机发的不该弹回来'), null, { timeout: 5000 });
await sleep(2000);
const bounced = await phone.evaluate(() => [...document.querySelectorAll('.item .text')].filter((e) => e.textContent === '手机发的不该弹回来').length);
check('手机发来的字不会被自动发回手机', bounced === 0, `弹回 ${bounced} 次`);
// 从密码管理器里复制的密码：不自动发，侧边栏说一声
await panel.evaluate((t) => navigator.clipboard.writeText(t), 'Xk9#mP2$vL7q');
await sleep(2000);
const pwSent = await phone.evaluate(() => document.body.innerText.includes('Xk9#mP2$vL7q'));
const pwTip = await panel.evaluate(() => document.body.innerText.includes('像密码'));
check('「复制就发」：复制的像密码就不自动发，侧边栏说一声', !pwSent && pwTip, `手机收到 ${pwSent}，提示 ${pwTip}`);
await panel.uncheck('.auto input');

// 很长的文字（整篇文档、长代码，超过直连一条消息的上限 256KB）：两个方向都能送到，后面的不被卡住
const longPc = ('电脑上复制的一大段文档，第一行\n' + 'const x = "很长的代码";\n'.repeat(20)).repeat(400);
// （测试工具往输入框里打十几万字会卡住，直接放进去，效果和粘贴一样）
const putText = (pg, t) => pg.evaluate((t) => { const a = document.querySelector('textarea'); a.value = t; a.dispatchEvent(new Event('input', { bubbles: true })); }, t);
await putText(panel, longPc);
await panel.click('button:has-text("发到手机")');
await panel.fill('textarea', '长文后面的一条');
await panel.click('button:has-text("发到手机")');
const longOk = await phone.waitForFunction((n) => [...document.querySelectorAll('.item .text')].some((e) => e.textContent.length === n), longPc.length, { timeout: 15000 }).then(() => true, () => false);
const afterLong = await phone.waitForFunction(() => document.body.innerText.includes('长文后面的一条'), null, { timeout: 5000 }).then(() => true, () => false);
check('电脑发很长的文字到手机：整段送到，后面的也到了', longOk && afterLong, `${(new TextEncoder().encode(longPc).length / 1024).toFixed(0)} KB`);
const longPhone = '手机上复制的长文章。'.repeat(30000);
await putText(phone, longPhone);
await phone.getByRole('button', { name: '发送', exact: true }).click();
const longBack = await panel.waitForFunction((n) => [...document.querySelectorAll('.item .text')].some((e) => e.textContent.length === n), longPhone.length, { timeout: 15000 }).then(() => true, () => false);
check('手机发很长的文字到电脑：整段送到', longBack, `${(new TextEncoder().encode(longPhone).length / 1024).toFixed(0)} KB`);

// 验证码大字显示
await panel.fill('textarea', '384920');
await panel.click('button:has-text("发到手机")');
await phone.waitForSelector('.text.code', { timeout: 5000 });
check('验证码在手机上大字显示', (await phone.textContent('.text.code')) === '384920');
const tabState = () => panel.evaluate(() => ({
  on: document.querySelector('.tabs .on')?.className.match(/t-(phone|pc)/)?.[1],
  from: [...new Set([...document.querySelectorAll('.item')].map((e) => e.dataset.from))].join(','),
  dbg: document.querySelector('.tabs')?.innerText.replace(/\s+/g, ' ') + ' ls=' + localStorage.getItem('tab') + ' top=' + document.querySelector('.item .meta')?.innerText
}));
await panel.waitForSelector('.tabs .t-pc.on', { timeout: 3000 }).catch(() => {});
const afterSend = await tabState();
check('侧边栏分两栏：刚发到手机后显示「发到手机的」，只有电脑发出的', afterSend.on === 'pc' && afterSend.from === 'pc', JSON.stringify(afterSend));
if (process.env.E2E_SHOTS) { await panel.setViewportSize({ width: 380, height: 1000 }); await panel.screenshot({ path: process.env.E2E_SHOTS + '/panel-pc.png' }); }

// 网页上右键「发到手机」（测试脚本点不了真的右键菜单，直接调用插件里处理菜单的那段）
const web = await ctx.newPage();
await web.goto('http://localhost:8080/e2e/page.html');
await web.evaluate(() => { const r = document.createRange(); r.selectNodeContents(document.getElementById('t')); getSelection().removeAllRanges(); getSelection().addRange(r); });
const bgw = () => ctx.serviceWorkers()[0] ?? sw;
const menu = (info) => bgw().evaluate(async (info) => {
  const [tab] = await chrome.tabs.query({ url: 'http://localhost:8080/e2e/*' });
  await globalThis.__menuClicked(info, tab);
}, info);
await menu({ menuItemId: 'sel', selectionText: '第一行 第二行', frameId: 0 });
await phone.waitForFunction(() => [...document.querySelectorAll('.item .text')].some((e) => e.textContent === '第一行\n第二行'), null, { timeout: 5000 })
  .then(() => check('右键发选中的文字：手机收到（换行保留）', true), () => check('右键发选中的文字：手机收到（换行保留）', false));
check('网页右下角闪出「已发到手机」', await web.evaluate(() => document.getElementById('hutong-toast')?.dataset.ok === 'true'));
const imgsBefore = await phone.locator('.item[data-kind="image"]').count();
await menu({ menuItemId: 'img', srcUrl: 'http://localhost:8080/e2e/pic.png' });
await phone.waitForFunction((n) => document.querySelectorAll('.item[data-kind="image"] img').length > n, imgsBefore, { timeout: 15000 })
  .then(() => check('右键发网页上的图：手机收到', true), () => check('右键发网页上的图：手机收到', false));
await menu({ menuItemId: 'page', pageUrl: 'http://localhost:8080/e2e/page.html' });
await phone.waitForFunction(() => document.body.innerText.includes('localhost:8080/e2e/page.html'), null, { timeout: 5000 })
  .then(() => check('右键发网址：手机收到', true), () => check('右键发网址：手机收到', false));

// 手机发来东西时，侧边栏没在看：插件图标上出数字；打开侧边栏看了就清掉
await sleep(2800); // 等刚才「送到了 ✓」闪完
const panelVis = (v) => panel.evaluate((v) => { Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => v }); document.dispatchEvent(new Event('visibilitychange')); }, v);
await panelVis('hidden');
await phone.fill('textarea', '角标测试');
await phone.getByRole('button', { name: '发送', exact: true }).click();
await panel.waitForFunction(() => document.body.innerText.includes('角标测试'), null, { timeout: 5000 });
await panel.waitForSelector('.tabs .t-phone.on', { timeout: 3000 }).catch(() => {});
const afterGot = await tabState();
check('侧边栏分两栏：手机发来新的就切到「手机发来的」，只有手机发来的', afterGot.on === 'phone' && afterGot.from === 'phone', JSON.stringify(afterGot));
if (process.env.E2E_SHOTS) await panel.screenshot({ path: process.env.E2E_SHOTS + '/panel-phone.png' });
await sleep(300);
const badgeOn = await bgw().evaluate(() => chrome.action.getBadgeText({}));
await panelVis('visible');
await sleep(500);
const badgeOff = await bgw().evaluate(() => chrome.action.getBadgeText({}));
check('插件图标上出现新消息数字，看过后清掉', /^\d+$/.test(badgeOn) && badgeOff === '', `「${badgeOn}」→「${badgeOff}」`);
await web.close();

// 侧边栏的照片拖进网页（测试脚本做不了真的跨页面拖拽：在侧边栏发「开始拖」，再让 Chrome 把照片当作从外面拖进网页）
const drop = await ctx.newPage();
await drop.goto('http://localhost:8080/e2e/drop.html');
await drop.bringToFront();
const want = await panel.evaluate(async () => {
  const img = document.querySelector('.item[data-kind="image"][data-from="phone"] img');
  const b = new Uint8Array(await (await fetch(img.src)).arrayBuffer());
  return { size: b.length, sum: b.reduce((a, x) => (a * 31 + x) >>> 0, 7) };
});
let viewLink = '';
const photoImg = '.item[data-kind="image"][data-from="phone"] img';
/** 在侧边栏开始拖照片，返回拖着的数据（照片编号、地址） */
const startDrag = () => panel.evaluate((sel) => {
  const dt = new DataTransfer();
  document.querySelector(sel).dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
  return { id: dt.getData('application/x-hutong-photo'), uri: dt.getData('text/uri-list') };
}, photoImg);
const endDrag = () => panel.evaluate((sel) => document.querySelector(sel).dispatchEvent(new DragEvent('dragend', { bubbles: true })), photoImg);
/** 让 Chrome 自己把一次「从外面拖进来」的拖拽送进网页（和真拖进来一样：浏览器发的事件，没人接就打开拖着的地址） */
async function browserDrop(pg, sel, items) {
  const box = sel ? await pg.locator(sel).boundingBox() : { x: 300, y: 300, width: 10, height: 10 };
  const x = box.x + box.width / 2, y = box.y + box.height / 2;
  const cdp = await pg.context().newCDPSession(pg);
  const data = { items, dragOperationsMask: 19 };
  await cdp.send('Input.dispatchDragEvent', { type: 'dragEnter', x, y, data });
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await sleep(700);
  await cdp.send('Input.dispatchDragEvent', { type: 'dragOver', x, y, data });
  await cdp.send('Input.dispatchDragEvent', { type: 'drop', x, y, data });
  await cdp.detach().catch(() => {});
}
async function dragTo(sel) {
  const { id, uri } = await startDrag();
  viewLink = uri;
  await sleep(600);
  const before = await drop.evaluate(() => log.length);
  await browserDrop(drop, sel, [{ mimeType: 'application/x-hutong-photo', data: id }, { mimeType: 'text/uri-list', data: uri }]);
  await sleep(800);
  await endDrag();
  return drop.evaluate((n) => log.slice(n), before);
}
const same = (f) => f && f.size === want.size && f.sum === want.sum && f.type.startsWith('image/') && /\.(png|jpe?g)$/.test(f.name);
let got = await dragTo('#zone');
const z = got.find((x) => x.where === 'zone');
check('照片拖进网页上传区：网页收到真文件，一字节不差', same(z?.file), JSON.stringify(got).slice(0, 200));
check('拖着经过时上传区会亮（看得到文件）', got.some((x) => typeof x === 'string' && x.startsWith('zone-enter:') && x.includes('Files')));
check('网页没收到打不开的内部地址', !got.includes('page-saw-url') && drop.url().startsWith('http://localhost:8080/e2e/drop.html'));
got = await dragTo('#pick');
check('照片拖到「选择文件」按钮上：放进去了', same(got.find((x) => x.where === 'input')?.file), JSON.stringify(got).slice(0, 200));
got = await dragTo('#ed');
check('照片拖进输入框：当作粘贴放进去了', same(got.find((x) => x.where === 'paste')?.file), JSON.stringify(got).slice(0, 200));
const opened = ctx.waitForEvent('page', { timeout: 5000 }).catch(() => null);
got = await dragTo('#plain');
const viewPage = await opened;
const viewSize = async (pg) => {
  await pg.waitForSelector('img', { timeout: 5000 });
  return pg.evaluate(async () => (await (await fetch(document.querySelector('img').src)).arrayBuffer()).byteLength);
};
check('拖到网页上放不了图的地方：在旁边新标签页打开这张照片', !!viewPage && viewPage.url().includes('/view.html?') && (await viewSize(viewPage)) === want.size && got.length === 0,
  `${viewPage?.url().slice(0, 70)} ${JSON.stringify(got)}`);
await viewPage?.close();
await drop.close();

// 拖到接收员管不到的网页上（没给权限、Chrome 自己的页面、新标签页）：Chrome 会打开拖着的地址，
// 而且打开时说不出是谁打开的（来源不明）。用一个「来源不明」的页面去打开地址，和真拖进去时 Chrome 的判断一样。
check('拖着的地址是转到「看照片」的网页', /^http:\/\/localhost:8080\/open\.html#chrome-extension/.test(viewLink), viewLink.slice(0, 60));
const bare = await ctx.newPage();
const openFromNowhere = async (u) => {
  await bare.goto('data:text/html,<title>nowhere</title>');
  await bare.evaluate((u) => { location.href = u; }, u);
  await sleep(1500);
};
await openFromNowhere(decodeURIComponent(viewLink.split('#')[1]));
const directOk = await bare.evaluate(() => !!document.querySelector('img[alt]')).catch(() => false);
check('（对照）以前的做法：直接打开插件页面会被 Chrome 拦（曦截图里的「已被屏蔽」）', !directOk, bare.url().slice(0, 60));
const { uri: dropUri } = await startDrag();
await endDrag();
await openFromNowhere(dropUri);
await bare.waitForURL(/view\.html/, { timeout: 8000 }).catch(() => {});
check('拖到没有接收员的地方：打开这张照片（不是空白页、不被拦）', bare.url().includes('/view.html') && (await viewSize(bare).catch(() => -1)) === want.size, bare.url().slice(0, 70));
await bare.close();

// 切到别的 App 再回来，电脑那头其实早断了（模拟 iPhone 暂停网页）：要自动重连，并把这时发的照片送到
const before = await panel.locator('.item[data-kind="image"]').count();
await phone.evaluate(() => { const l = window.__hutong.link; l.dc.onmessage = null; });
const vis = (hidden) => phone.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
await vis(true); await sleep(200); await vis(false);
const tResume = Date.now();
await phone.setInputFiles('input[type=file]', { name: 'IMG_0002.png', mimeType: 'image/png', buffer: testPng(300, 200) });
await panel.waitForFunction((n) => document.querySelectorAll('.item[data-kind="image"]').length > n, before, { timeout: 15000 });
const resumeOk = await phone.waitForFunction(() => document.querySelector('.sent')?.dataset.state === 'done', null, { timeout: 10000 }).then(() => true, () => false);
check('切回网页后自动重连，断线时发的照片送到', resumeOk, `${Date.now() - tResume} 毫秒`);
if (!resumeOk) {
  console.log('--- 手机日志 ---\n' + phoneLog.slice(-40).join('\n'));
  console.log('--- 电脑日志 ---\n' + (await panel.textContent('footer pre')).split('\n').slice(0, 30).reverse().join('\n'));
  console.log('手机待发：', await phone.evaluate(() => JSON.stringify(window.__hutong.transfer.pending.map((p) => p.id))));
}

// 确认丢了：手机重发同一条，电脑只算一次
await phone.evaluate(() => { const t = window.__hutong.transfer; t.__onAck = t.onAck; t.onAck = () => {}; });
await phone.fill('textarea', '只该出现一次');
await phone.getByRole('button', { name: '发送', exact: true }).click();
await panel.waitForFunction(() => document.body.innerText.includes('只该出现一次'), null, { timeout: 5000 });
await phone.evaluate(() => { const t = window.__hutong.transfer; t.onAck = t.__onAck; });
await phone.waitForFunction(() => window.__hutong.transfer.pending.length === 0, null, { timeout: 25000 });
const copies = await panel.evaluate(() => [...document.querySelectorAll('.item .text')].filter((e) => e.textContent === '只该出现一次').length);
check('手机重发同一条，电脑只收一次', copies === 1, `出现 ${copies} 次`);

// 手机网页关着时电脑发的：中间 Chrome 还重启了一次（引擎重开），手机打开后照样补发
// 同时开着「复制就发」：手机没连着时复制的，连上后送最后一条
await phone.close();
await sleep(1000);
await panel.fill('textarea', '攒着的一句话');
await panel.click('button:has-text("发到手机")');
const restartEngine = async () => {
  await (ctx.serviceWorkers()[0] ?? sw).evaluate(() => chrome.offscreen.closeDocument());
  await panel.reload();
  await panel.waitForSelector('.status', { timeout: 10000 });
  await sleep(1500);
};
await restartEngine();
await panel.check('.auto input');
await sleep(1000);
await panel.evaluate((t) => navigator.clipboard.writeText(t), '锁屏时复制的第一条');
await sleep(1000);
await panel.evaluate((t) => navigator.clipboard.writeText(t), '锁屏时复制的最后一条');
await sleep(1000);
phone = await phoneCtx.newPage();
logPhone(phone);
await phone.goto('http://localhost:8080/');
await phone.waitForFunction(() => document.body.innerText.includes('攒着的一句话'), null, { timeout: 25000 })
  .then(() => check('Chrome 重启过、手机重新打开网页：收到攒着的', true), () => check('Chrome 重启过、手机重新打开网页：收到攒着的', false));
await phone.waitForFunction(() => document.body.innerText.includes('锁屏时复制的最后一条'), null, { timeout: 8000 }).catch(() => {});
const clipGot = await phone.evaluate(() => ({ last: document.body.innerText.includes('锁屏时复制的最后一条'), first: document.body.innerText.includes('锁屏时复制的第一条') }));
check('「复制就发」：没连着时复制的，连上后只送最后一条', clipGot.last && !clipGot.first, JSON.stringify(clipGot));
await panel.uncheck('.auto input');

// 模拟 iPhone 锁屏 20 秒：直连断了，到介绍人的连接也悄悄死了（看着还连着，其实发不出去）。解锁后要很快连上
await phone.waitForSelector('.status[data-link="connected"]', { timeout: 10000 });
await phone.evaluate(() => {
  const s = window.__hutong;
  const c = s.signal.bus.client;
  c.stream.write = () => true;      // 发出去的都丢了
  c.removeAllListeners('message');  // 也收不到了
  s.link.pc?.close();
});
const vis2 = (hidden) => phone.evaluate((h) => { Object.defineProperty(document, 'hidden', { configurable: true, get: () => h }); document.dispatchEvent(new Event('visibilitychange')); }, hidden);
await vis2(true);
await phone.evaluate(() => { const real = Date.now; Date.now = () => real() + 20000; }); // 时间过了 20 秒
await panel.fill('textarea', '锁屏时电脑发的');
await panel.click('button:has-text("发到手机")');
const tUnlock = Date.now();
await vis2(false);
const unlockOk = await phone.waitForFunction(() => document.body.innerText.includes('锁屏时电脑发的'), null, { timeout: 10000 }).then(() => true, () => false);
check('锁屏 20 秒后解锁：很快重连，收到锁屏时电脑发的', unlockOk, `${Date.now() - tUnlock} 毫秒`);
if (!unlockOk) console.log('--- 手机日志 ---\n' + phoneLog.slice(-25).join('\n'));

// 手机发的时候电脑关着，手机网页也被关掉重开：电脑开了以后照样收到
await (ctx.serviceWorkers()[0] ?? sw).evaluate(() => chrome.offscreen.closeDocument());
await sleep(500);
await phone.fill('textarea', '手机攒着的一句话');
await phone.getByRole('button', { name: '发送', exact: true }).click();
await sleep(500);
await phone.reload();
await phone.waitForSelector('.sent', { timeout: 5000 }).catch(() => {});
const phoneRestored = await phone.evaluate(() => document.querySelector('.sent')?.textContent ?? '');
await panel.reload();
const phoneQueuedOk = await panel.waitForFunction(() => document.body.innerText.includes('手机攒着的一句话'), null, { timeout: 25000 }).then(() => true, () => false);
check('手机网页关掉重开、电脑后来才开：照样收到手机攒着的', phoneQueuedOk, phoneRestored.trim());

// 放到桌面的互传（和浏览器各存各的，没有配对暗号）：点「扫码配对」用摄像头扫电脑上的码
// 测试里用一张画着电脑二维码的画布假装摄像头
await panel.click('button:has-text("换一台手机")').catch(() => {});
await panel.waitForSelector('.qr svg', { timeout: 5000 });
const qrSvg = await panel.evaluate(() => document.querySelector('.qr svg').outerHTML);
const homeCtx = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 } });
await homeCtx.addInitScript((svg) => {
  navigator.mediaDevices.getUserMedia = async () => {
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 480;
    const g = cv.getContext('2d');
    const img = new Image();
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svg);
    await img.decode();
    const draw = () => { g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 480); g.drawImage(img, 180, 100, 280, 280); };
    draw(); setInterval(draw, 100);
    return cv.captureStream(10);
  };
}, qrSvg);
await phone.close(); // 现在电脑同一时间只连一台手机：浏览器里那个先关掉（iPhone 上两个也不会同时在前台）
// 手机没开时发的，点「不发了」：从待发里拿掉，之后连上的手机收不到
await panel.click('.tabs .t-pc').catch(() => {});
await panel.fill('textarea', '发错了不想发');
await panel.click('button:has-text("发到手机")');
const wrong = panel.locator('.item[data-from="pc"]', { hasText: '发错了不想发' });
await wrong.locator('button.cancel').click({ timeout: 5000 }).catch(() => {});
await sleep(500);
const cancelMeta = await wrong.locator('.meta').textContent().catch(() => '');
check('还没送到的点「不发了」：显示已取消', cancelMeta.includes('已取消'), cancelMeta.trim().replace(/\s+/g, ' '));
const home = await homeCtx.newPage();
await home.goto('http://localhost:8080/');
await home.click('button:has-text("扫码配对")');
const scanOk = await home.waitForSelector('.status[data-link="connected"]', { timeout: 20000 }).then(() => true, () => false);
check('桌面版：点「扫码配对」扫电脑上的码，连上电脑', scanOk, scanOk ? '' : (await home.textContent('main')).slice(0, 120));
await sleep(1500);
check('取消了的不会送到后来连上的手机', !(await home.evaluate(() => document.body.innerText.includes('发错了不想发'))));
check('电脑上提醒「有一台新手机连上了」', await panel.evaluate(() => document.body.innerText.includes('有一台新手机连上了')));
await homeCtx.close();

// 公司网络不让设备直接通信：两边都要说清楚，而不是一直转圈
const blockCtx = await phoneBrowser.newContext({ viewport: { width: 390, height: 844 } });
await blockCtx.addInitScript(() => {
  const Orig = window.RTCPeerConnection;
  const srd = Orig.prototype.setRemoteDescription;
  Orig.prototype.setRemoteDescription = function (d) { return srd.call(this, { type: d.type, sdp: d.sdp.replace(/a=candidate:.*\r\n/g, '') }); };
  window.RTCPeerConnection = function (cfg) { return new Orig({ ...(cfg || {}), iceTransportPolicy: 'relay' }); };
  window.RTCPeerConnection.prototype = Orig.prototype;
});
const blocked = await blockCtx.newPage();
await blocked.goto(pairUrl);
const phoneBlocked = await blocked.waitForSelector('.status[data-link="blocked"]', { timeout: 15000 }).then(() => true, () => false);
const pcBlocked = await panel.waitForSelector('.status[data-link="blocked"]', { timeout: 10000 }).then(() => true, () => false);
check('网络不让直连：手机和电脑都提示「这个网络不让直连」', phoneBlocked && pcBlocked,
  `手机「${(await blocked.textContent('.status')).trim()}」 电脑「${(await panel.textContent('.status')).trim()}」`);
await blockCtx.close();

if (process.env.E2E_SHOTS) {
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.screenshot({ path: join(process.env.E2E_SHOTS, 'panel.png'), fullPage: true });
  if (!phone.isClosed()) await phone.screenshot({ path: join(process.env.E2E_SHOTS, 'phone.png'), fullPage: true });
}

console.log(failures ? `\n${failures} 项没通过` : '\n全部通过');
await ctx.close();
await phoneBrowser.close();
process.exit(failures ? 1 : 0);
