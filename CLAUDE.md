# 给写代码的 Claude / Codex 的规矩

产品方案在 README 链接的「结构方案」文档里。动手前先读它和本文件。

## 和曦沟通
曦完全不懂技术。只说做好了什么、要曦在**电脑**还是**手机**上做什么；不解释框架和实现。

## 架构（不要绕开）
- 一个仓库，三端共用 `packages/core`。配对、消息格式、连接、待发队列只写在核心里。
- 分层：`signal.ts`（介绍人：SignalBus 收发字符串 → SecureSignal 加密/签名/防重放）→ `link.ts`（WebRTC 直连 PeerLink）→ `transfer.ts`（发一条/收一条：待发队列、确认、去重、分块）→ `session.ts`（拼起来）。
- 「怎么送过去」是 `Pipe` 接口。以后加服务器中转 = 再实现一个 Pipe，上层不动。
- 换介绍人服务器 = 改 `packages/core/src/config.ts`（`signal.kind` / `urls`），或构建时设 `VITE_SIGNAL_KIND` / `VITE_SIGNAL_URLS`。
- 每条消息带协议版本号 `v`。看不懂的消息不能崩，只提示升级（`decode` 返回 `newer`）。加新消息类型时保持向后兼容。
- 插件：连接和写剪贴板都在 offscreen 引擎（`apps/extension/src/lib/engine.ts`）里。offscreen 只能用 `chrome.runtime` 收发消息，不能用 storage、getManifest 等；需要的数据用 localStorage / IndexedDB。
- Chrome 不允许后台页面往剪贴板放图片：照片自动存进「下载\互传」，复制靠点通知弹出的小窗口（`copyimg`）或侧边栏按钮。
- iPhone 网页切到别的 App 连接就断：手机回到前台要调用 `link.resume()`；发出去的东西没确认就留在待发队列，连上后自动补发，接收方按 id 去重。

## 改完必须
- `npm test` 和 `npm run check` 通过；动了连接/传输逻辑要跑 `xvfb-run -a npm run e2e`。
- 手机网页改了要 `npm run build` 并提交 `app/`（GitHub Pages 从 main 根目录发布，约 10 分钟缓存）。
- 插件改了要升 `apps/extension/package.json` 的 version，手机网页改了升 `apps/mobile/package.json` 的 version，方便曦确认是新版。
