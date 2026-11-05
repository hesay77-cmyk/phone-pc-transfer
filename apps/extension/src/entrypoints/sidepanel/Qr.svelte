<script lang="ts">
  import qrcode from 'qrcode-generator';
  let { text, size = 200 }: { text: string; size?: number } = $props();
  const svg = $derived.by(() => {
    const q = qrcode(0, 'M');
    q.addData(text);
    q.make();
    return q.createSvgTag({ cellSize: 4, margin: 2, scalable: true });
  });
</script>

<div class="qr" style="width:{size}px;height:{size}px" data-url={text}>{@html svg}</div>

<style>
  .qr { background: #fff; padding: 6px; border-radius: 10px; display: inline-block; }
  .qr :global(svg) { width: 100%; height: 100%; display: block; }
</style>
