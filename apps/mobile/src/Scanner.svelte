<script lang="ts">
  // 用手机摄像头扫电脑上的配对二维码（放到桌面的互传第一次打开时用；苹果相机扫码会打开浏览器，不会打开桌面版）
  import { secretFromHash } from '@hutong/core';
  let { onSecret, onClose }: { onSecret: (secret: string) => void; onClose: () => void } = $props();

  let video = $state<HTMLVideoElement>();
  let err = $state('');
  let stream: MediaStream | null = null;
  let stopped = false;

  $effect(() => {
    void start();
    return () => { stopped = true; stream?.getTracks().forEach((t) => t.stop()); };
  });

  function parse(text: string): string | null {
    try { return secretFromHash(new URL(text).hash); } catch { return null; }
  }

  async function start() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
    } catch {
      err = '打不开摄像头。请在弹出的提示里点「允许」；如果之前点了不允许，到手机「设置」里把相机权限打开。';
      return;
    }
    if (stopped || !video) { stream.getTracks().forEach((t) => t.stop()); return; }
    video.srcObject = stream;
    await video.play().catch(() => {});
    const { default: jsQR } = await import('jsqr'); // 扫码程序用到时才下载
    const cv = document.createElement('canvas');
    const g = cv.getContext('2d', { willReadFrequently: true })!;
    const tick = () => {
      if (stopped || !video) return;
      if (video.readyState >= 2 && video.videoWidth) {
        const w = Math.min(720, video.videoWidth);
        const h = Math.round((video.videoHeight * w) / video.videoWidth);
        cv.width = w; cv.height = h;
        g.drawImage(video, 0, 0, w, h);
        const code = jsQR(g.getImageData(0, 0, w, h).data, w, h, { inversionAttempts: 'dontInvert' });
        if (code?.data) {
          const secret = parse(code.data);
          if (secret) { stopped = true; stream?.getTracks().forEach((t) => t.stop()); onSecret(secret); return; }
          err = '这不是 Tapaste 的二维码。请扫电脑上Tapaste 侧边栏里的码。';
        }
      }
      setTimeout(tick, 120);
    };
    tick();
  }
</script>

<div class="scan">
  <div class="frame"><video bind:this={video} playsinline muted autoplay></video></div>
  <p>把电脑上Tapaste 侧边栏里的二维码对准上面的框。</p>
  <p class="hint">电脑上没看到二维码？点开Tapaste 侧边栏，在最下面点「换一台手机 / 显示二维码」。</p>
  {#if err}<p class="err">{err}</p>{/if}
  <button class="btn" onclick={onClose}>取消</button>
</div>

<style>
  .scan { text-align: center; }
  .frame { width: min(78vw, 320px); aspect-ratio: 1; margin: 4px auto 14px; border-radius: 20px; box-shadow: 0 0 0 3px var(--accent-soft); overflow: hidden; background: #000; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  p { margin: 0 0 8px; font-size: 16px; }
  .hint { font-size: 13.5px; color: var(--muted); }
  .err { color: var(--bad); font-size: 14px; }
  .btn { padding: 9px 22px; border: none; background: var(--card); color: var(--fg); border-radius: 12px; font-size: 15px; font-weight: 550; }
</style>
