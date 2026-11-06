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
    // 名字和介绍中英两份，在 public/_locales 里（中文为主：商店默认显示中文）
    name: '__MSG_extName__',
    description: '__MSG_extDescription__',
    default_locale: 'zh_CN',
    minimum_chrome_version: '116',
    permissions: ['offscreen', 'notifications', 'clipboardWrite', 'clipboardRead', 'downloads', 'contextMenus', 'activeTab', 'scripting', 'storage'],
    // 右键发网页上的图时才问用户要（自动测试时直接给，免得弹窗卡住）
    ...(process.env.VITE_E2E ? { host_permissions: ['<all_urls>'] } : { optional_host_permissions: ['<all_urls>'] }),
    action: { default_title: 'Tapaste' },
    // 照片拖到网页或新标签页上时，Chrome 会打开这个「看照片」页面
    web_accessible_resources: [{ resources: ['view.html'], matches: ['<all_urls>'] }],
    commands: {
      _execute_action: { suggested_key: { default: 'Alt+Shift+V' }, description: '__MSG_cmdOpen__' },
      // 全局快捷键：Chrome 不在前台（在 Word、记事本里）也能用。Chrome 只允许 Ctrl+Shift+数字 做全局键
      'send-clipboard': { suggested_key: { default: 'Ctrl+Shift+1' }, description: '__MSG_cmdSendClipboard__', global: true } as any
    }
  }
});
