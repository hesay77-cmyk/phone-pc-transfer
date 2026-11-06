// node cap.js <scene> <lang> <outdir> [fps]
const { chromium } = require('playwright');
const fs = require('fs');
const path = require('path');
const [scene, lang, out, fpsArg] = process.argv.slice(2);
const FPS = +(fpsArg || 30);
const DT = 1000 / FPS;
const URL = 'http://localhost:8765/index.html';

(async () => {
  fs.mkdirSync(out, { recursive: true });
  const browser = await chromium.launch({ args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--hide-scrollbars'] });
  const ctx = await browser.newContext({
    viewport: { width: 1280, height: 720 }, deviceScaleFactor: +(process.env.DSF || 1.5),
    locale: lang === 'en' ? 'en-US' : 'zh-CN', colorScheme: 'dark',
  });
  await ctx.addInitScript({ path: path.join(__dirname, 'vclock.js') });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => console.error('pageerror', e.message));
  await page.goto(URL, { waitUntil: 'load' });
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ content: '#glowc{display:none!important} nav{display:none!important} .scroll{display:none!important} html{scroll-behavior:auto!important}' });
  const cdp = await ctx.newCDPSession(page);
  let n = 0;
  const shot = async () => {
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'jpeg', quality: 93, optimizeForSpeed: true });
    fs.writeFileSync(path.join(out, String(n++).padStart(5, '0') + '.jpg'), Buffer.from(data, 'base64'));
  };
  const adv = (ms) => page.evaluate((m) => window.__adv(m), ms);
  // h = helpers available to scenes
  const h = {
    page,
    // advance silently (no frames)
    async warm(sec) { const steps = Math.round(sec * 1000 / DT); for (let i = 0; i < steps; i++) { await adv(DT); if (i % 6 === 0) await page.waitForTimeout(20); } },
    async rec(sec, each) { const steps = Math.round(sec * FPS); for (let i = 0; i < steps; i++) { if (each) await each(i / steps); await adv(DT); await shot(); } },
    async scrollTo(sel, off = 0) { await page.evaluate(([s, o]) => { const el = document.querySelector(s); window.scrollTo(0, el.getBoundingClientRect().top + scrollY + o); }, [sel, off]); },
    async glide(sel, off, sec) {
      const [y0, y1] = await page.evaluate(([s, o]) => { const el = document.querySelector(s); return [scrollY, el.getBoundingClientRect().top + scrollY + o]; }, [sel, off]);
      await h.rec(sec, (t) => { const e = t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2; return page.evaluate((y) => window.scrollTo(0, y), y0 + (y1 - y0) * e); });
    },
    click: (sel) => page.evaluate((s) => document.querySelector(s).click(), sel),
  };
  const scenes = require('./scenes.js'); h.lang = lang;
  await scenes[scene](h);
  console.log(scene, lang, 'frames', n);
  await browser.close();
})();
