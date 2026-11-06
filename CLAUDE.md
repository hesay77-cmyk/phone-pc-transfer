# 给写代码的 Claude / Codex 的规矩

产品方案在 README 链接的「结构方案」文档里。动手前先读它和本文件。

## 和曦沟通
曦完全不懂技术。只说做好了什么、要曦在**电脑**还是**手机**上做什么；不解释框架和实现。

## 名字
产品名 **Tapaste**（2026-11-05 定，官网 https://hidaydream.com/tapaste/ ）。界面上提到产品/插件/网页时写 Tapaste（「Tapaste 网页」「Tapaste 侧边栏」）；「互传」只当动词用。照片存在「下载\Tapaste」（插件 0.4.3 起；之前叫「下载\互传」，老照片还在那里）。

## 中英双语（插件 0.5.0 / 手机 0.5.0 起）
- 跟随系统语言（2026-11-06 曦定）：`core/lang.ts` 的 `pickLang`，`zh*`（含繁体，繁体以后单独做）显示简体中文，其他所有语言显示英文。
- 界面文字只写在 `apps/extension/src/lib/i18n.ts` 和 `apps/mobile/src/i18n.ts`（`zh` 一份、`en: typeof zh` 一份，少了哪个 TypeScript 会报错）。加新文字两份都要写。运行记录（log）是排查用的，只写中文。
- 插件名字、介绍、快捷键说明在 `apps/extension/public/_locales/{zh_CN,en}/messages.json`，`default_locale` 是 `zh_CN`（商店以中文为主）。英文介绍要和商店页一致（官网线程定的）。
- 对方报上来的设备名是按对方语言起的，显示前用 `localDeviceName` 换成这边的语言。
- e2e 主流程按中文系统跑（`locale: 'zh-CN'` + `LANGUAGE=zh_CN`），最后用英文系统再测一遍。

## 架构（不要绕开）
- 一个仓库，三端共用 `packages/core`。配对、消息格式、连接、待发队列只写在核心里。
- 分层：`signal.ts`（介绍人：SignalBus 收发字符串 → SecureSignal 加密/签名/防重放）→ `link.ts`（WebRTC 直连 PeerLink）→ `transfer.ts`（发一条/收一条：待发队列、确认、去重、分块）→ `session.ts`（拼起来）。
- 「怎么送过去」是 `Pipe` 接口。以后加服务器中转 = 再实现一个 Pipe，上层不动。
- 换介绍人服务器 = 改 `packages/core/src/config.ts`（`signal.kind` / `urls`），或构建时设 `VITE_SIGNAL_KIND` / `VITE_SIGNAL_URLS`。
- 每条消息带协议版本号 `v`。看不懂的消息不能崩，只提示升级（`decode` 返回 `newer`）。加新消息类型时保持向后兼容。
- 插件：连接和写剪贴板都在 offscreen 引擎（`apps/extension/src/lib/engine.ts`）里。offscreen 只能用 `chrome.runtime` 收发消息，不能用 storage、getManifest 等；需要的数据用 localStorage / IndexedDB。
- Chrome 不允许后台页面往剪贴板放图片：照片自动存进「下载\Tapaste」，复制靠点通知弹出的小窗口（`copyimg`）或侧边栏按钮。
- 网页右键「发到手机」在后台（`background.ts` 的 `menuClicked`）：选中文字用 scripting 重新取（保留换行），网页上的图要可选权限 `<all_urls>`，只能在点菜单那一下 `permissions.request`；被拒或报错就让用户去侧边栏点「允许发网页上的图」。结果用网页右下角小提示（toast）告诉用户，不依赖 Windows 通知（很多人关了 Chrome 通知）。
- 「发刚复制的」（侧边栏按钮）和全局快捷键 Ctrl+Shift+1（`send-clipboard`，Chrome 不在前台也能用）都走引擎的 `sendClipboard`：offscreen 里用 `execCommand('paste')` 读剪贴板（要 clipboardRead 权限），有图发图、没图发文字。
- 「复制就发」开关（默认关）：引擎每 700ms 读一次剪贴板文字，变了且手机连着就发；手机发来的字写进剪贴板时记为 lastClip，防止弹回手机。看着像密码的（`core/text.ts` 的 `looksLikePassword`：8–64 个可见英文字符、无空格、字母+数字+第三类）不发，侧边栏提示一次（`skippedSecretAt`）。
- 插件图标角标由引擎管：蓝色数字 = 新收到没看的条数（侧边栏可见时清零），绿色 ✓ = 发到手机的都送到了。
- 手机「放到桌面」：苹果桌面图标和浏览器存储分开，曦实测桌面版打开没带上配对。所以手机网页有「扫码配对」（`Scanner.svelte`，摄像头 + jsQR，用到时才加载）；桌面版第一次打开扫一下。（`manifest.webmanifest` 不写 start_url、看步骤时把 `#k=暗号` 放回网址这招留着，但不可靠。）
- 侧边栏照片拖进网页：Chrome 从侧边栏拖图，网页只拿到 `blob:chrome-extension://…` 地址（上传框不认，拖到空白处会打开空白页）。现在的做法（0.3.6，`lib/pagedrop.ts`）：照片 dragstart 时往每个窗口当前网页（所有框架）注入「接收员」，它在 window 捕获阶段挡住这次拖拽，向侧边栏要照片（`drag-file` 消息，base64），做成真 File 再发给网页：先发合成的 drop，网页不接就塞进附近的 `input[type=file]`，再不行当作粘贴进输入框，都不行就在旁边新标签页打开这张照片（`view.html`）。拖着的网址（text/uri-list）换成手机网页同站的 `open.html#<view.html 地址>`：拖到接收员管不到的地方（新标签页、没权限的网页、标签栏）Chrome 会打开它，它马上转到 `view.html`（web_accessible）显示照片。不能直接拖 `view.html`：Chrome 打开拖进来的地址时发起方是「来源不明」（没有前身的 opaque origin），打开插件页面会被拦（ERR_BLOCKED_BY_CLIENT，0.3.7 曦实测，e2e 用 data: 页面复现）。接收员要 `<all_urls>` 权限（没给就在侧边栏提示「允许」）。`chrome.downloads.drag` 在侧边栏里试过，照片完全拖不动（0.3.4，已撤回），别再用。接收员只理 `isTrusted` 的拖拽事件（武装期间别的网页伪造 drop 拿不到照片）。
- 电脑同一时间只连一台手机：新手机（新 sid）来打招呼就断开旧的。两个手机页面同时开着会互相抢。界面写的是「换一台手机」，不要写「加一台」。引擎记着连过的手机（KV `knownPhones`），没见过的手机连上时侧边栏提醒「有一台新手机连上了」（`newPhone`），给「换一个新码」入口；换码会清掉待发队列和 knownPhones。手机网页已经配过对、又打开带别的 `#k=` 的链接，要先 confirm 才换。
- 连接状态 `blocked`：通过介绍人找到对方、双方都回应了，6 秒还没直连上 = 这个网络不让设备之间直接通信（公司/公共 Wi-Fi）。两边界面要说清楚，不要一直转圈。
- 公共 STUN（`config.ts` 的 `iceServers`，国内小米 + Cloudflare + 谷歌，2026-11-05 曦定加上）：让访客网络、2.4G/5G 分网段、拦 mDNS 的家用路由器也有机会连上，副作用是部分跨网络（手机流量 + 电脑在家）也能免费直连。不走 trickle ICE（加新消息类型会让旧版本提示升级），`waitIce` 在配了 STUN 时多等外网地址（srflx），最多 1 秒（`SRFLX_WAIT_MS`）。`VITE_STUN_URLS=none` 关掉。
- 界面：侧边栏用 `sidepanel/app.css` 的变量（紫蓝渐变 `--grad`）。手机网页照 iPhone 自带 App 做（2026-11-05 曦要「像 iPhone 原生软件」）：系统字体、`#f2f2f7` 分组卡片、大标题 + 滚动后出现毛玻璃顶栏、品牌靛蓝当强调色（`mobile/src/app.css`），新内容用 svelte 的 fly/flip 滑入；别加花哨装饰。深色模式另配，标志是「两块屏叠在一起」（2026-11-05 曦选的：白底，紫/蓝两块圆角屏叠着；图形在 `scripts/logo.svg`，图标用 `node scripts/make-icons.mjs` 生成）。改界面别动 e2e 依赖的 class（`.status[data-link]`、`.send`、`.auto input`、`.tabs .t-*.on`、`.item[data-kind][data-from]`、`.meta`、`button.cancel`、`.sent[data-state]`、`.qr`、`footer pre`）。
- 发文件（2026-11-05 曦要做，插件 0.4.3 / 手机 0.4.7 起）：两边都能发任意文件，走和照片一样的分块传输。能直接显示的图片（`core/files.ts` 的 `isShowableImage`）当照片（kind `image`），别的当文件（kind `file`）。电脑收到的文件自动存进「下载\Tapaste」（`safeFileName`，失败退回 `asciiFileName`）；手机收到的存在 IndexedDB（和照片同一个 `BlobStore`，只留最近 20 条），「存到手机 / 打开」用 `navigator.share`（iPhone 选「存储到文件」），不行就退回 `<a download>`。一次最多发 `CONFIG.maxFileBytes`（100MB，收的一方要整个放在内存里）；协议里 `MAX_FILE_BYTES`（1GB）是收的一方的上限，数据比 `file-start` 说的多就整个丢掉。分支 `feature/files-later` 已经合进来了，别再用。传的过程中两边都显示进度（2026-11-05 曦传 54MB 视频时要的，插件 0.4.5 / 手机 0.4.8）：收的一方用 `Transfer` 的 `receiving` 事件（开始、最多每 200ms 一次、停了会补报一次、收齐 `done`、没收成 `null`；长文字不报），手机在「电脑发来的」最上面、侧边栏在最上面显示「正在接收」卡片，30 秒没动静先藏起来（对方重发会再出来），断线时显示「连接断了，对方会重新发」；发的一方用 `progress`，侧边栏状态写「发送中 x%」（`Item.pct`，不存），手机「发出去的」一行写「发送中 x%」。
- 单条删除（小垃圾桶）：侧边栏每条都有（引擎 `delete-item`，还没送到的顺便不发了，照片从小数据库删掉）；手机「电脑发来的」「发出去的」每条都有（发出去的还没送到就顺便取消）。侧边栏换栏用 `{#key tab}` 整块换掉，免得淡出动画让两栏的内容同时出现。
- iPhone 网页切到别的 App、锁屏，连接就断：手机回到前台要调用 `session.resume(在后台待了多少毫秒)`。待久了（>4 秒）介绍人的连接会「看着连着其实死了」，`SignalBus.wake` 直接重连（否则要等心跳超时几十秒，就是「解锁后连半天」）；>15 秒直连不探直接重连。
- 发出去的东西没确认就留在待发队列（`persistentOutbox` 存在本机：文字在 KV，图片在 IndexedDB `hutong-out`），关掉网页/重启 Chrome 也不丢，连上后自动补发，接收方按 id 去重。待发项可以取消（`Transfer.cancel`，两端都有「不发了」），放了 24 小时（`OUTBOX_EXPIRE_MS`）没送到就不发了，同一条连发 3 次通道都好着却发不出去就算失败——都通过 `dropped` 事件告诉界面，不能让一条卡住后面所有的。多条同时等确认时只重连一次。超过 2 万字的文字在待发队列里存 IndexedDB（localStorage 只有约 5MB）。
- 长文字：WebRTC 单条消息上限 256KB。超过 48KB（`LONG_TEXT_BYTES`）的文字按文件分块发（`file-start` 的 `meta.asText: true`），收的一方拼回文字；旧版本收到的是一个 .txt 文件，不会崩。记录里只存前 2 万字（`trimForHistory`，标 `cut`），两端都有「清空记录」。
- 引擎里「先送到、后入列表」：小图的确认可能比 `addItem`（要先 `await putFile`）先到，`patch` 找不到这条就先存进 `early`，`addItem` 时补上（否则会一直显示「等手机打开网页」）。
- 新通道刚开时对方可能已经在发了：`Transfer.linkUp` 不能清掉正在收的文件（以前这样做导致偶尔白等 8 秒）。

## 改完必须
- `npm test` 和 `npm run check` 通过；动了连接/传输逻辑要跑 `xvfb-run -a npm run e2e`。
- 手机网页改了要 `npm run build` 并提交 `app/`。正式地址是 https://hidaydream.com/tapaste/app/（插件 0.5.1 起二维码指向这里，`config.ts` 的 `phoneUrl`；由官网线程从 main 的 `app/` 部署到曦的服务器，改完要告诉官网线程）。GitHub Pages 那份（main 根目录发布，约 10 分钟缓存）保留，老版本插件配过对的手机还在用。
- 插件改了要升 `apps/extension/package.json` 的 version，手机网页改了升 `apps/mobile/package.json` 的 version，方便曦确认是新版。
