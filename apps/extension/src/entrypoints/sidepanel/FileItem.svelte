<script lang="ts">
  // 文件（文档、压缩包等）：显示名字；手机发来的能打开所在文件夹
  import type { Item } from '../../lib/types';
  let { item, onShow }: { item: Item; onShow: (id: number) => void } = $props();
</script>

<div class="file"><span class="icon">📄</span><span class="name">{item.name}</span></div>
{#if item.from === 'phone' && item.saved?.ok && item.saved.downloadId !== undefined}
  <button onclick={() => onShow(item.saved!.downloadId!)}>打开所在文件夹</button>
{/if}
{#if item.saved && !item.saved.ok}
  <div class="small bad">没能自动保存：{item.saved.detail}</div>
{/if}

<style>
  .file { display: flex; gap: 6px; align-items: center; margin: 2px 0 6px; font-size: 13.5px; word-break: break-all; }
  .icon { font-size: 18px; }
  .small { font-size: 12px; margin-top: 4px; }
  .bad { color: var(--bad); }
</style>
