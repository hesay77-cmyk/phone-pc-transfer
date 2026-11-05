<script lang="ts">
  // 电脑发来的图：显示出来，能存到相册、能复制
  import type { BlobStore } from '@hutong/core';
  let { id, name, store }: { id: string; name: string; store: BlobStore } = $props();

  let url = $state('');
  let gone = $state(false);
  let saveLabel = $state('存到相册');
  let copyLabel = $state('复制');
  let tip = $state('');
  // 先读好：iPhone 要求点按钮的那一刻就调用分享/复制，中间不能再等读数据
  let blob: Blob | null = null;

  $effect(() => {
    let made = '';
    void store.get(id).then((b) => {
      if (!b) { gone = true; return; }
      blob = b;
      url = made = URL.createObjectURL(b);
    });
    return () => { if (made) URL.revokeObjectURL(made); };
  });

  // iPhone 上弹出系统的分享菜单，里面选「存储图像」就进相册了
  async function save() {
    if (!blob) return;
    const f = new File([blob], name || 'photo', { type: blob.type });
    try {
      if (!navigator.canShare?.({ files: [f] })) throw new Error('no-share');
      await navigator.share({ files: [f] });
    } catch (e) {
      if ((e as Error).name === 'AbortError') return;
      tip = '长按上面的图片，选「存储到照片」或「保存图片」';
    }
  }

  async function copy() {
    if (!blob) return;
    try {
      // 苹果只认 PNG：先转一下（放在 Promise 里，按钮按下那一刻就占住剪贴板）
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': toPng(blob) })]);
      copyLabel = '已复制';
    } catch {
      copyLabel = '复制失败';
      tip = '长按上面的图片，选「拷贝」';
    }
  }

  async function toPng(b: Blob): Promise<Blob> {
    if (b.type === 'image/png') return b;
    const bmp = await createImageBitmap(b);
    const cv = document.createElement('canvas');
    cv.width = bmp.width; cv.height = bmp.height;
    cv.getContext('2d')!.drawImage(bmp, 0, 0);
    return new Promise((res, rej) => cv.toBlob((x) => (x ? res(x) : rej(new Error('png'))), 'image/png'));
  }
</script>

{#if url}
  <img src={url} alt="电脑发来的图片" />
  <button class="btn" onclick={save}>{saveLabel}</button>
  <button class="btn" onclick={copy}>{copyLabel}</button>
  {#if tip}<p class="tip">{tip}</p>{/if}
{:else if gone}
  <p class="tip">图片已经不在了（只保留最近 20 张）</p>
{/if}

<style>
  img { display: block; max-width: 100%; max-height: 60vh; border-radius: 10px; margin: 6px 0 2px; -webkit-touch-callout: default; }
  .btn { display: inline-block; padding: 8px 14px; border: 1px solid var(--line); background: var(--bg, #fff); color: var(--fg); border-radius: 10px; margin: 6px 6px 0 0; font-size: 15px; }
  .tip { font-size: 13.5px; color: var(--muted); margin: 6px 0 0; }
</style>
