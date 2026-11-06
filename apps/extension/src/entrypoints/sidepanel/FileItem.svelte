<script lang="ts">
  import { t } from '../../lib/i18n';
  import type { Item } from '../../lib/types';
  let { item, onShow }: { item: Item; onShow: (id: number) => void } = $props();

  const ext = $derived(((item.name ?? '').match(/\.([a-z0-9]{1,4})$/i)?.[1] ?? '').toUpperCase());
</script>

<div class="file">
  <div class="ic" aria-hidden="true">
    <svg viewBox="0 0 24 24"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" /><path d="M14 3v5h5" /></svg>
    {#if ext}<span>{ext}</span>{/if}
  </div>
  <div class="name" title={item.name}>{item.name || t.fileFallback}</div>
</div>
{#if item.from === 'phone' && item.saved?.ok && item.saved.downloadId !== undefined}
  <div class="row"><button onclick={() => onShow(item.saved!.downloadId!)}>{t.showInFolder}</button></div>
{/if}
{#if item.saved && !item.saved.ok}
  <div class="small bad">{t.notSaved(item.saved.detail ?? '')}</div>
{/if}

<style>
  .file { display: flex; align-items: center; gap: 10px; padding: 8px 10px; margin: 2px 0 8px; border-radius: 10px; background: var(--card); }
  .ic { position: relative; flex: none; width: 34px; height: 40px; color: var(--accent); }
  .ic svg { width: 100%; height: 100%; fill: var(--accent-soft); stroke: currentColor; stroke-width: 1.4; stroke-linejoin: round; }
  /* 扩展名做成一个小色块标签：比纸宽也像是故意的，不会被裁 */
  .ic span { position: absolute; left: 50%; bottom: 7px; transform: translateX(-50%); padding: 1px 3px; border-radius: 3px; background: var(--accent); color: #fff; font-size: 7.5px; line-height: 1.25; font-weight: 700; white-space: nowrap; }
  .name { min-width: 0; font-weight: 500; overflow-wrap: anywhere; display: -webkit-box; -webkit-line-clamp: 2; line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .row button { padding: 3px 12px; font-size: 12px; border-radius: 8px; }
  .small { font-size: 12px; margin-top: 4px; }
  .bad { color: var(--bad); }
</style>
