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
- 网页右键「发到手机」在后台（`background.ts` 的 `menuClicked`）：选中文字用 scripting 重新取（保留换行），网页上的图要可选权限 `<all_urls>`，只能在点菜单那一下 `permissions.request`；被拒或报错就让用户去侧边栏点「允许发网页上的图」。结果用网页右下角小提示（toast）告诉用户，不依赖 Windows 通知（很多人关了 Chrome 通知）。
- 「发刚复制的」（侧边栏按钮）和全局快捷键 Ctrl+Shift+1（`send-clipboard`，Chrome 不在前台也能用）都走引擎的 `sendClipboard`：offscreen 里用 `execCommand('paste')` 读剪贴板（要 clipboardRead 权限），有图发图、没图发文字。
- 「复制就发」开关（默认关）：引擎每 700ms 读一次剪贴板文字，变了且手机连着就发；手机发来的字写进剪贴板时记为 lastClip，防止弹回手机。
- 插件图标角标由引擎管：蓝色数字 = 新收到没看的条数（侧边栏可见时清零），绿色 ✓ = 发到手机的都送到了。
- 手机「放到桌面」：苹果桌面图标和浏览器存储分开，曦实测桌面版打开没带上配对。所以手机网页有「扫码配对」（`Scanner.svelte`，摄像头 + jsQR，用到时才加载）；桌面版第一次打开扫一下。（`manifest.webmanifest` 不写 start_url、看步骤时把 `#k=暗号` 放回网址这招留着，但不可靠。）
- 电脑同一时间只连一台手机：新手机（新 sid）来打招呼就断开旧的。两个手机页面同时开着会互相抢。
- 连接状态 `blocked`：通过介绍人找到对方、双方都回应了，6 秒还没直连上 = 这个网络不让设备之间直接通信（公司/公共 Wi-Fi）。两边界面要说清楚，不要一直转圈。
- 发文件（文档等）曦说暂时不需要，做了一半的插件端在分支 `feature/files-later`。
- iPhone 网页切到别的 App、锁屏，连接就断：手机回到前台要调用 `session.resume(在后台待了多少毫秒)`。待久了（>4 秒）介绍人的连接会「看着连着其实死了」，`SignalBus.wake` 直接重连（否则要等心跳超时几十秒，就是「解锁后连半天」）；>15 秒直连不探直接重连。
- 发出去的东西没确认就留在待发队列（`persistentOutbox` 存在本机：文字在 KV，图片在 IndexedDB `hutong-out`），关掉网页/重启 Chrome 也不丢，连上后自动补发，接收方按 id 去重。
- 新通道刚开时对方可能已经在发了：`Transfer.linkUp` 不能清掉正在收的文件（以前这样做导致偶尔白等 8 秒）。

## 改完必须
- `npm test` 和 `npm run check` 通过；动了连接/传输逻辑要跑 `xvfb-run -a npm run e2e`。
- 手机网页改了要 `npm run build` 并提交 `app/`（GitHub Pages 从 main 根目录发布，约 10 分钟缓存）。
- 插件改了要升 `apps/extension/package.json` 的 version，手机网页改了升 `apps/mobile/package.json` 的 version，方便曦确认是新版。
