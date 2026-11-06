// 用 scripts/logo.svg 生成插件图标和手机网页图标。用法：node scripts/make-icons.mjs
// 界面里的标志（侧边栏、手机网页顶上）是同一个图形，改了 logo.svg 也要同步改 App.svelte 里的 <svg class="logo">。
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const { chromium } = createRequire(import.meta.url)('playwright');
const svg = readFileSync(join(ROOT, 'scripts/logo.svg'), 'utf8');
// 底板：logo.svg 里 width="32" height="32" 的那个 rect
const TILE = /<rect width="32" height="32" rx="[\d.]+"([^>]*)\/>/;
// 苹果桌面图标：苹果自己切圆角，透明的角会变黑，所以画成直角铺满
const square = svg.replace(TILE, '<rect width="32" height="32"$1/>');
// 浏览器右上角（16/32）：去掉白底板、图形放大铺满，小图才看得清
const small = svg.replace(TILE, '').replace('viewBox="0 0 32 32"', 'viewBox="4 4.25 22.5 22.5"');

const jobs = [
  ...[16, 32].map((s) => [s, small, `apps/extension/public/icon/${s}.png`]),
  ...[48, 128].map((s) => [s, svg, `apps/extension/public/icon/${s}.png`]),
  [192, svg, 'apps/mobile/public/icon-192.png'],
  [512, svg, 'apps/mobile/public/icon-512.png'],
  [180, square, 'apps/mobile/public/apple-touch-icon.png']
];
const b = await chromium.launch();
for (const [size, src, out] of jobs) {
  const p = await b.newPage({ viewport: { width: size, height: size } });
  await p.setContent(`<style>html,body{margin:0;background:transparent}svg{width:${size}px;height:${size}px;display:block}</style>${src}`);
  await p.screenshot({ path: join(ROOT, out), omitBackground: true });
  await p.close();
  console.log(out);
}
await b.close();
