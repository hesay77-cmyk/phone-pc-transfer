# 互传：手机电脑互传

手机上点一下，电脑上直接 Ctrl+V。同一个 Wi-Fi 下手机和电脑直连，传的内容不经过任何服务器。

- 电脑：Chrome / Edge 插件（`apps/extension`）
- 手机：网页，可以加到主屏幕（`apps/mobile`，正式地址 https://hidaydream.com/tapaste/app/ ，GitHub Pages 的 https://hesay77-cmyk.github.io/phone-pc-transfer/app/ 保留给老用户）
- 介绍人服务器：只帮两台设备交换连接信息（`apps/server`；现阶段借用公共 MQTT，换成它只改 `packages/core/src/config.ts`）

方案文档：[结构方案](https://claude.ai/artifact/GD2bU3jRNZEjj1nAkByJB3)。`step0/` 是第 0 步技术验证用的测试插件，留作参考。

## 目录

```
packages/core     共用核心：配对暗号、消息格式、加密的介绍信、直连、待发队列（插件和手机网页共用）
apps/extension    电脑插件（WXT + Svelte，Manifest V3）
apps/mobile       手机网页（Vite + Svelte），构建到根目录 app/ 由 GitHub Pages 发布
apps/server       介绍人服务器（Node + WebSocket，顺带放手机网页）
scripts/e2e.mjs   端到端测试：本机模拟插件 + 手机网页，走真实 WebRTC
```

## 常用命令

```
npm install
npm test            # 核心和服务器的自动测试
npm run check       # 类型检查
npm run build       # 构建插件（apps/extension/dist/chrome-mv3）和手机网页（app/）
xvfb-run -a npm run e2e   # 端到端测试（需要 Chromium + Playwright）
```

插件装法：Chrome 打开 `chrome://extensions` → 开发者模式 → 加载已解压的扩展程序 → 选 `apps/extension/dist/chrome-mv3`。
