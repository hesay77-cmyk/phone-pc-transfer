<script lang="ts">
  // 电脑发来的文件（文档、压缩包等）：存到手机「文件」App，或者用别的 App 打开
  import type { BlobStore } from '@hutong/core';
  import { L } from './i18n';
  let { id, name, mime, store }: { id: string; name: string; mime: string; store: BlobStore } = $props();

  let url = $state('');
  let gone = $state(false);
  let tip = $state('');
  // 先读好：iPhone 要求点按钮的那一刻就调用分享，中间不能再等读数据
  let file: File | null = null;
  const ext = $derived((name.match(/\.([a-z0-9]{1,4})$/i)?.[1] ?? '').toUpperCase());

  $effect(() => {
    let made = '';
    void store.get(id).then((b) => {
      if (!b) { gone = true; return; }
      file = new File([b], name || L.file, { type: b.type || mime || 'application/octet-stream' });
      url = made = URL.createObjectURL(file);
    });
    return () => { if (made) URL.revokeObjectURL(made); };
  });

  // 弹出系统的分享菜单：选「存储到文件」，或者直接选一个 App 打开
  async function save(e: MouseEvent) {
    if (!file) return;
    try {
      if (!navigator.canShare?.({ files: [file] })) throw new Error('no-share');
      e.preventDefault();
      await navigator.share({ files: [file] });
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // 分享用不了：让浏览器自己下载（链接本身带着 download）
      tip = L.fileDownloadTip;
    }
  }
</script>

<div class="file">
  <div class="ic" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
    {#if ext}<span>{ext}</span>{/if}
  </div>
  <div class="name">{name}</div>
</div>
{#if url}
  <div class="btns">
    <a class="btn" href={url} download={name} onclick={save}>{L.saveOrOpen}</a>
  </div>
  {#if tip}<p class="tip">{tip}</p>{:else}<p class="tip">{L.fileHint}</p>{/if}
{:else if gone}
  <p class="tip">{L.fileGone}</p>
{/if}

<style>
  .file { display: flex; align-items: center; gap: 12px; margin: 10px 0 12px; }
  .ic { position: relative; flex: none; width: 40px; height: 48px; color: var(--tint); }
  .ic svg { width: 100%; height: 100%; fill: var(--tint-soft); stroke: currentColor; stroke-width: 1.3; stroke-linejoin: round; }
  /* 扩展名做成一个小色块标签：比纸宽也像是故意的，不会被裁 */
  .ic span { position: absolute; left: 50%; bottom: 8px; transform: translateX(-50%); padding: 1px 3px; border-radius: 3px; background: var(--tint); color: #fff; font-size: 8px; line-height: 1.25; font-weight: 700; white-space: nowrap; }
  .name { min-width: 0; font-size: 17px; font-weight: 500; overflow-wrap: anywhere; }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }
  .btn { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border: none; border-radius: 17px; background: var(--tint-soft); color: var(--tint); font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; transition: transform .25s var(--ease), opacity .2s; }
  .btn:active { transform: scale(.94); opacity: .8; }
  .tip { font-size: 14px; color: var(--label2); margin: 10px 0 0; }
</style>
