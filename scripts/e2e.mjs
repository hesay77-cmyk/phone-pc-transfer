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

// 验证码大字显示
await panel.fill('textarea', '384920');
await panel.click('button:has-text("发到手机")');
await phone.waitForSelector('.text.code', { timeout: 5000 });
check('验证码在手机上大字显示', (await phone.textContent('.text.code')) === '384920');

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
await sleep(300);
const badgeOn = await bgw().evaluate(() => chrome.action.getBadgeText({}));
await panelVis('visible');
await sleep(500);
const badgeOff = await bgw().evaluate(() => chrome.action.getBadgeText({}));
check('插件图标上出现新消息数字，看过后清掉', /^\d+$/.test(badgeOn) && badgeOff === '', `「${badgeOn}」→「${badgeOff}」`);
await web.close();

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

// 手机网页关着时电脑发的，打开后补发
await phone.close();
await sleep(1000);
await panel.fill('textarea', '攒着的一句话');
await panel.click('button:has-text("发到手机")');
phone = await phoneCtx.newPage();
await phone.goto('http://localhost:8080/');
await phone.waitForFunction(() => document.body.innerText.includes('攒着的一句话'), null, { timeout: 25000 });
check('手机重新打开网页（不用再扫码），收到攒着的', true);

if (process.env.E2E_SHOTS) {
  await panel.setViewportSize({ width: 380, height: 900 });
  await panel.screenshot({ path: join(process.env.E2E_SHOTS, 'panel.png'), fullPage: true });
  await phone.screenshot({ path: join(process.env.E2E_SHOTS, 'phone.png'), fullPage: true });
}

console.log(failures ? `\n${failures} 项没通过` : '\n全部通过');
await ctx.close();
await phoneBrowser.close();
process.exit(failures ? 1 : 0);
