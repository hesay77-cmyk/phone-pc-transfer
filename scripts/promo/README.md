# 宣传视频（官网动画录成的 34 秒横屏视频，中/英两版）

用官网 `apps/site`（在 claude/project-thread-3okyqu 分支）的动画逐帧录：`vclock.js` 接管页面里所有计时（GSAP、requestAnimationFrame、CSS 动画），每帧精确前进 1/30 秒再截图，所以画面不卡。

1. 在 `apps/site` 目录起本地服务：`python3 -m http.server 8765`
2. 录五段（每段一个文件夹的截图）：
   `DSF=3 node cap.js hero zh out/zh/hero`（首屏录 3 倍清晰度，后面要推近）
   `node cap.js story|look|features|end zh out/zh/<段名>`
3. 首屏推近：`python3 zoom.py out/zh/hero out/zh/heroz 0.71 0.49 1.4 2.2 3.6`
4. 拼接 + 配乐：`./build.sh zh 输出.mp4`（`music.py` 现场合成轻柔背景音乐；英文版把 zh 换成 en）

每段的动作和时长在 `scenes.js`。成片放在曦电脑 `E:\ai\phone-pc-transfer\宣传视频`。
