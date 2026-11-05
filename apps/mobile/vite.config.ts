import { svelte } from '@sveltejs/vite-plugin-svelte';
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 手机网页。构建结果放到仓库根目录的 app/，GitHub Pages 直接发布（以后放自己的服务器上也是这份）。
export default defineConfig({
  plugins: [svelte()],
  base: './',
  define: { __APP_VERSION__: JSON.stringify(pkg.version) },
  resolve: { alias: { '@hutong/core': new URL('../../packages/core/src/index.ts', import.meta.url).pathname } },
  build: {
    outDir: process.env.MOBILE_OUT_DIR || '../../app',
    emptyOutDir: true,
    target: 'es2020'
  }
});
