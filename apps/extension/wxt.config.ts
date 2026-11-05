import { readFileSync } from 'node:fs';
import { defineConfig } from 'wxt';

const pkg = JSON.parse(readFileSync(new URL('./package.json', import.meta.url), 'utf8'));

// 电脑插件。Chrome 和 Edge 通用（不用 Chrome 独有的功能）。
export default defineConfig({
  srcDir: 'src',
  outDir: process.env.EXT_OUT_DIR || 'dist',
  modules: ['@wxt-dev/module-svelte'],
  imports: false,
  // 引擎页面（offscreen）拿不到 manifest，版本号在构建时写进去
  vite: () => ({ define: { __APP_VERSION__: JSON.stringify(pkg.version) } }),
  manifest: {
    name: '互传',
    description: '手机和电脑互传文字、照片：手机上点一下，电脑上直接 Ctrl+V。同一个 Wi-Fi 下直连，内容不经过任何服务器。',
    minimum_chrome_version: '116',
    permissions: ['offscreen', 'notifications', 'clipboardWrite', 'downloads'],
    action: { default_title: '互传' },
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+V' }, description: '打开互传' }
    }
  }
});
