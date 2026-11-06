<script lang="ts">
  import { getFile, photoName, toPng } from '../../lib/files';
  import { t } from '../../lib/i18n';
  import { disarmPageDropSoon, startPhotoDrag } from '../../lib/pagedrop';
  import type { Item } from '../../lib/types';
  let { item, onShow, onNeedPermission }: { item: Item; onShow: (id: number) => void; onNeedPermission: () => void } = $props();

  let url = $state('');
  let copyLabel = $state(t.copyImage);
  $effect(() => {
    const id = item.id;
    let made = '';
    void getFile(id).then((b) => { if (b && id === item.id) url = made = URL.createObjectURL(b); });
    return () => { if (made) URL.revokeObjectURL(made); };
  });

  // 拖进网页 / 拖进 Chrome：见 lib/pagedrop.ts
  function dragStart(e: DragEvent) {
    // 文件名和「下载\Tapaste」里存的那张一样
    const saved = item.saved?.path?.split(/[\\/]/).pop();
    const name = saved && /\.\w{3,4}$/.test(saved) ? saved : photoName(item.mime || 'image/jpeg', false, new Date(item.time));
    startPhotoDrag(e, { id: item.id, name }, onNeedPermission);
  }
  const dragEnd = () => disarmPageDropSoon();

  async function copy() {
    try {
      const b = await getFile(item.id);
      if (!b) throw new Error(t.photoGoneErr);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': await toPng(b) })]);
      copyLabel = t.copiedPaste;
    } catch (e) {
      copyLabel = t.copyFailed;
    }
  }
</script>

{#if url}
  <img src={url} alt={item.from === 'phone' ? t.altFromPhone : t.altToPhone} draggable="true" title={t.dragHint} ondragstart={dragStart} ondragend={dragEnd} />
{:else}
  <div class="gone">{t.photoGone30}</div>
{/if}
{#if item.from === 'phone'}
  <div class="row">
    <button onclick={copy}>{copyLabel}</button>
    {#if item.saved?.ok && item.saved.downloadId !== undefined}
      <button onclick={() => onShow(item.saved!.downloadId!)}>{t.showInFolder}</button>
    {/if}
  </div>
{/if}
{#if item.saved && !item.saved.ok}
  <div class="small bad">{t.notSaved(item.saved.detail ?? '')}</div>
{/if}

<style>
  img { max-width: 100%; max-height: 280px; display: block; border-radius: 10px; margin: 2px 0 8px; cursor: grab; box-shadow: 0 0 0 1px var(--line); }
  .gone { color: var(--muted); font-size: 12.5px; margin: 4px 0; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; }
  .row button { padding: 3px 12px; font-size: 12px; border-radius: 8px; }
  .small { font-size: 12px; margin-top: 4px; }
  .bad { color: var(--bad); }
</style>
