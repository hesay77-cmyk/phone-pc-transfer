<script lang="ts">
  import { browser } from 'wxt/browser';
  import type { EngineState, Item, ToBg, ToEngine, ToPanel } from '../../lib/types';
  import ImageItem from './ImageItem.svelte';
  import Qr from './Qr.svelte';

  let s = $state<EngineState | null>(null);
  let showQr = $state(false);
  let out = $state('');
  let sendTip = $state('');
  let failed = $state(false);

  const engine = (m: ToEngine) => browser.runtime.sendMessage(m);
  const bg = (m: ToBg) => browser.runtime.sendMessage(m);

  browser.runtime.onMessage.addListener((m: ToPanel) => {
    if (m?.to === 'panel' && m.type === 'state') s = m.state;
  });

  async function load() {
    await bg({ to: 'bg', type: 'ensure-engine' }).catch(() => {});
    for (let i = 0; i < 15; i++) {
      const st = await engine({ to: 'engine', type: 'get-state' }).catch(() => null);
      if (st) { s = st; return; }
      await new Promise((r) => setTimeout(r, 300));
    }
    failed = true;
  }
  void load();

  const status = $derived.by(() => {
    if (!s) return { cls: 'wait', text: '正在启动…' };
    if (s.link === 'connected') return { cls: 'ok', text: `已连上${s.phoneName ? ' ' + s.phoneName : '手机'}` };
    if (s.link === 'connecting') return { cls: 'wait', text: '手机正在连过来…' };
    if (s.signal !== 'online') return { cls: 'wait', text: '正在连接网络…' };
    return { cls: 'idle', text: s.everPaired ? '等手机来连：手机上打开互传网页就会自动连上' : '还没配对手机' };
  });

  async function send() {
    const text = out;
    if (!text.trim()) return;
    const r = await engine({ to: 'engine', type: 'send-text', text });
    out = '';
    sendTip = r?.connected ? '已发出' : '手机现在没打开网页，先存着，打开后自动送到';
  }

  async function reset() {
    if (!confirm('换一个新的二维码？之前配对过的手机需要重新扫码。')) return;
    s = await engine({ to: 'engine', type: 'reset-pairing' });
    showQr = true;
  }

  async function copyText(it: Item, e: MouseEvent) {
    await navigator.clipboard.writeText(it.text ?? '');
    (e.target as HTMLButtonElement).textContent = '已复制';
  }

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const kb = (n?: number) => (!n ? '' : n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  const showFile = (downloadId: number) => void bg({ to: 'bg', type: 'show-file', downloadId });
</script>

<main>
  <header>
    <h1>互传</h1>
    <div class="status {status.cls}" data-link={s?.link ?? ''}><span class="dot"></span>{status.text}</div>
    {#if s?.link === 'connected' && s.route}<div class="small">{s.route}，{s.connectMs} 毫秒连上</div>{/if}
    {#if s?.newerPeer}<div class="small bad">手机那边的版本比插件新，请更新插件</div>{/if}
  </header>

  {#if failed}
    <p class="bad">插件后台没启动起来。请到 chrome://extensions 里把「互传」关掉再打开。</p>
  {:else if s}
    {#if !s.everPaired || showQr}
      <section class="pair">
        <h2>{s.everPaired ? '加一台手机' : '第一步：用 iPhone 扫码'}</h2>
        <p class="hint">用 iPhone 自带的相机扫下面的码，会打开互传网页。手机和电脑要连同一个 Wi-Fi。以后在手机上打开这个网页就能用。</p>
        <Qr text={s.pairingUrl} />
        <p class="small">
          {#if s.everPaired}<button class="link" onclick={() => (showQr = false)}>收起</button> · {/if}
          <button class="link" onclick={reset}>换一个新码</button>
        </p>
      </section>
    {/if}

    <section>
      <h2>收到的</h2>
      {#if s.items.length === 0}
        <p class="hint">手机发来的文字会自动复制好，直接 Ctrl+V；照片会自动存进「下载\互传」文件夹。</p>
      {/if}
      <div class="items">
        {#each s.items as it (it.id)}
          <div class="item" data-kind={it.kind} data-from={it.from}>
            <div class="meta">
              {it.from === 'phone' ? '手机发来' : it.delivered ? '发到手机 · 手机已收到' : '发到手机 · 等手机打开网页'}
              · {time(it.time)}{#if it.kind === 'image'} · {kb(it.size)}{/if}
              {#if it.kind === 'text' && it.from === 'phone' && it.copied} · 已复制{/if}
            </div>
            {#if it.kind === 'text'}
              <div class="text">{it.text}</div>
              <button onclick={(e) => copyText(it, e)}>复制</button>
            {:else}
              <ImageItem item={it} onShow={showFile} />
            {/if}
          </div>
        {/each}
      </div>
    </section>

    <section>
      <h2>发到手机</h2>
      <textarea rows="2" bind:value={out} placeholder="输入或粘贴一段文字，比如一个网址"></textarea>
      <button class="primary" onclick={send}>发到手机</button>
      <span class="small">{sendTip}</span>
    </section>

    <footer>
      {#if s.everPaired && !showQr}<button class="link" onclick={() => (showQr = true)}>加一台手机 / 显示二维码</button> · {/if}
      <span>版本 {s.version}</span>
      <details><summary>运行记录</summary><pre>{s.log.join('\n')}</pre></details>
    </footer>
  {/if}
</main>

<style>
  main { padding: 12px 14px 40px; }
  header { margin-bottom: 4px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  h2 { font-size: 15px; margin: 0 0 6px; }
  section { border-top: 1px solid var(--line); padding: 12px 0; }
  .status { font-size: 13.5px; }
  .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 6px; vertical-align: middle; background: var(--muted); }
  .ok { color: var(--ok); } .ok .dot { background: var(--ok); }
  .wait { color: var(--wait); } .wait .dot { background: var(--wait); }
  .idle { color: var(--muted); }
  .bad { color: var(--bad); }
  .hint, .small { color: var(--muted); font-size: 12.5px; margin: 0 0 8px; }
  .items { display: flex; flex-direction: column; gap: 8px; }
  .item { background: var(--card); border-radius: 10px; padding: 8px 10px; }
  .meta { color: var(--muted); font-size: 12px; margin-bottom: 4px; }
  .text { white-space: pre-wrap; word-break: break-all; font-size: 13.5px; margin-bottom: 6px; }
  textarea { margin-bottom: 6px; }
  footer { border-top: 1px solid var(--line); padding-top: 10px; color: var(--muted); font-size: 12px; }
  pre { white-space: pre-wrap; font-size: 11.5px; max-height: 260px; overflow: auto; }
</style>
