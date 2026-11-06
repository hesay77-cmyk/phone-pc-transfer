<script lang="ts">
  // 用手机摄像头扫电脑上的配对二维码（放到桌面的互传第一次打开时用；苹果相机扫码会打开浏览器，不会打开桌面版）
  import { secretFromHash } from '@hutong/core';
  import { L } from './i18n';
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
      err = L.cameraFail;
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
          err = L.notOurQr;
        }
      }
      setTimeout(tick, 120);
    };
    tick();
  }
</script>

<div class="scan">
  <div class="frame"><video bind:this={video} playsinline muted autoplay></video><i class="c tl"></i><i class="c tr"></i><i class="c bl"></i><i class="c br"></i></div>
  <p>{L.aimQr}</p>
  <p class="hint">{L.noQr}</p>
  {#if err}<p class="err">{err}</p>{/if}
  <button class="btn" onclick={onClose}>{L.cancel}</button>
</div>

<style>
  .scan { text-align: center; }
  .frame { position: relative; width: min(76vw, 300px); aspect-ratio: 1; margin: 4px auto 18px; border-radius: 28px; overflow: hidden; background: #000; }
  video { width: 100%; height: 100%; object-fit: cover; display: block; }
  .c { position: absolute; width: 34px; height: 34px; border: 4px solid #fff; opacity: .9; }
  .tl { top: 16px; left: 16px; border-right: 0; border-bottom: 0; border-top-left-radius: 14px; }
  .tr { top: 16px; right: 16px; border-left: 0; border-bottom: 0; border-top-right-radius: 14px; }
  .bl { bottom: 16px; left: 16px; border-right: 0; border-top: 0; border-bottom-left-radius: 14px; }
  .br { bottom: 16px; right: 16px; border-left: 0; border-top: 0; border-bottom-right-radius: 14px; }
  p { margin: 0 0 8px; font-size: 17px; }
  .hint { font-size: 14px; color: var(--label2); }
  .err { color: var(--red); font-size: 15px; }
  .btn { margin-top: 8px; height: 40px; padding: 0 26px; border: none; border-radius: 20px; background: var(--fill); color: var(--label); font-size: 16px; font-weight: 600; cursor: pointer; }
  .btn:active { transform: scale(.96); }
</style>
