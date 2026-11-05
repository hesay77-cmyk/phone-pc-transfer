<script lang="ts">
  import { getFile, toPng } from '../../lib/files';
  import type { Item } from '../../lib/types';
  let { item, onShow }: { item: Item; onShow: (id: number) => void } = $props();

  let url = $state('');
  let copyLabel = $state('复制这张图');
  $effect(() => {
    const id = item.id;
    let made = '';
    void getFile(id).then((b) => { if (b && id === item.id) url = made = URL.createObjectURL(b); });
    return () => { if (made) URL.revokeObjectURL(made); };
  });

  async function copy() {
    try {
      const b = await getFile(item.id);
      if (!b) throw new Error('照片已经不在了');
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPng(b) })]);
      copyLabel = '已复制，去 Ctrl+V';
    } catch (e) {
      copyLabel = '复制失败';
    }
  }
</script>

{#if url}
  <img src={url} alt={item.from === 'phone' ? '手机发来的照片' : '发到手机的图片'} draggable="true" title="可以直接拖进网页" />
{:else}
  <div class="gone">照片已经不在了（只保留最近 30 张）</div>
{/if}
{#if item.from === 'phone'}
  <div class="row">
    <button onclick={copy}>{copyLabel}</button>
    {#if item.saved?.ok && item.saved.downloadId !== undefined}
      <button onclick={() => onShow(item.saved!.downloadId!)}>打开所在文件夹</button>
    {/if}
  </div>
{/if}
{#if item.saved && !item.saved.ok}
  <div class="small bad">没能自动保存：{item.saved.detail}</div>
{/if}

<style>
  img { max-width: 100%; max-height: 280px; display: block; border-radius: 8px; margin: 4px 0 8px; cursor: grab; }
  .gone { color: var(--muted); font-size: 12.5px; margin: 4px 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .small { font-size: 12px; margin-top: 4px; }
  .bad { color: var(--bad); }
</style>
