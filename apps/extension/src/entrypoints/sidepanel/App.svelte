<script lang="ts">
  import { browser } from 'wxt/browser';
  import { putFile } from '../../lib/files';
  import { answerDragFile } from '../../lib/pagedrop';
  import type { EngineState, Item, SendResult, ToBg, ToEngine, ToPanel } from '../../lib/types';
  import ImageItem from './ImageItem.svelte';
  import Qr from './Qr.svelte';

  let s = $state<EngineState | null>(null);
  let showQr = $state(false);
  let out = $state('');
  let sendTip = $state('');
  let sendOk = $state(false);
  let failed = $state(false);
  let dragging = $state(false);
  let fileInput = $state<HTMLInputElement>();
  let notPinned = $state(false);
  let box = $state<HTMLTextAreaElement>();
  // 侧边栏一打开就能直接打字/粘贴
  $effect(() => { box?.focus(); });

  async function setAuto(on: boolean) {
    s = await engine({ to: 'engine', type: 'set-auto-send', on });
  }

  function onKey(e: KeyboardEvent) {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); void send(); }
  }
  let needImagePermission = $state(false);

  answerDragFile();
  const engine = (m: ToEngine) => browser.runtime.sendMessage(m);
  const bg = (m: ToBg) => browser.runtime.sendMessage(m);

  browser.runtime.onMessage.addListener((m: ToPanel) => {
    if (m?.to === 'panel' && m.type === 'state') { s = m.state; markSeen(); }
  });

  // 侧边栏开着就算看过了：清掉插件图标上的数字
  function markSeen() {
    if (s?.unseen && document.visibilityState === 'visible') void engine({ to: 'engine', type: 'seen' }).catch(() => {});
  }
  document.addEventListener('visibilitychange', markSeen);

  // 插件图标没固定在右上角的话，用户看不到图标上的数字：提醒一下
  async function checkPinned() {
    try {
      const st = await (browser.action as any).getUserSettings?.();
      notPinned = st ? !st.isOnToolbar && localStorage.getItem('pinTipClosed') !== '1' : false;
    } catch { notPinned = false; }
  }
  void checkPinned();
  setInterval(checkPinned, 5000);

  // 「在网页上读取和更改数据」的权限：右键发网页上的图、把照片拖进网页都要。没给过才提示
  void browser.storage.local.get('needImagePermission').then(async (r) => {
    const has = await browser.permissions.contains({ origins: ['<all_urls>'] }).catch(() => false);
    needImagePermission = !!r.needImagePermission && !has;
    if (has && r.needImagePermission) void browser.storage.local.remove('needImagePermission');
  });
  function needPermission() {
    needImagePermission = true;
    void browser.storage.local.set({ needImagePermission: true });
  }
  async function allowImages() {
    if (await browser.permissions.request({ origins: ['<all_urls>'] })) {
      needImagePermission = false;
      void browser.storage.local.remove('needImagePermission');
      permTip = '好了。现在可以把照片直接拖进网页，也能在网页的图片上右键发到手机';
    }
  }
  let permTip = $state('');

  async function load() {
    await bg({ to: 'bg', type: 'ensure-engine' }).catch(() => {});
    for (let i = 0; i < 15; i++) {
      const st = await engine({ to: 'engine', type: 'get-state' }).catch(() => null);
      if (st) { s = st; markSeen(); return; }
      await new Promise((r) => setTimeout(r, 300));
    }
    failed = true;
  }
  void load();

  const status = $derived.by(() => {
    if (!s) return { cls: 'wait', text: '正在启动…' };
    if (s.link === 'connected') return { cls: 'ok', text: `已连上${s.phoneName ? ' ' + s.phoneName : '手机'}` };
    if (s.link === 'connecting') return { cls: 'wait', text: '手机正在连过来…' };
    if (s.link === 'blocked') return { cls: 'bad', text: '手机找到了，但这个网络不让手机和电脑直接连' };
    if (s.signal !== 'online') return { cls: 'wait', text: '正在连接网络…' };
    return { cls: 'idle', text: s.everPaired ? '等手机来连：手机上打开互传网页就会自动连上' : '还没配对手机' };
  });

  function showResult(r: SendResult | undefined, what = '') {
    sendOk = !!r?.ok;
    sendTip = !r?.ok ? (r?.error ?? '没发出去')
      : r.connected ? `✓ ${what}已发到手机` : `${what}先存着，手机打开互传网页后自动送到`;
  }

  async function send() {
    const text = out;
    if (!text.trim()) return;
    const r: SendResult = await engine({ to: 'engine', type: 'send-text', text });
    out = '';
    showResult(r);
  }

  /** 发图片：选的、粘贴的、拖进来的都走这里（先放进小数据库，再让引擎发） */
  async function sendImages(files: File[]) {
    const imgs = files.filter((f) => f.type.startsWith('image/'));
    if (!imgs.length) { if (files.length) { sendOk = false; sendTip = '现在只能发图片'; } return; }
    for (const f of imgs) {
      const fileId = 'up:' + Math.random().toString(36).slice(2);
      await putFile(fileId, f);
      const r: SendResult = await engine({ to: 'engine', type: 'send-file', fileId, name: f.name || shotName() });
      showResult(r, imgs.length > 1 ? '' : '图片');
    }
  }

  const shotName = () => `截图 ${new Date().toLocaleTimeString().replace(/:/g, '-')}.png`;

  /** 侧边栏里任何地方按 Ctrl+V：剪贴板里是图片（比如刚截的图）就直接发到手机 */
  function onPaste(e: ClipboardEvent) {
    // 往输入框里粘文字时（剪贴板里同时有字和图，比如从 Word 复制的）照常粘文字
    if (e.target instanceof HTMLTextAreaElement && e.clipboardData?.types.includes('text/plain')) return;
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file' && i.type.startsWith('image/'))
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); void sendImages(files); }
  }

  /** 按钮：把刚复制的内容（文字或截图）发到手机。先让引擎读；读不到再用侧边栏自己读 */
  async function sendClipboard() {
    const r: SendResult = await engine({ to: 'engine', type: 'send-clipboard' }).catch(() => ({ ok: false, error: '读不到剪贴板' }));
    if (r.ok || !r.error?.startsWith('读不到剪贴板')) { showResult(r, r.what ?? ''); return; }
    try {
      const files: File[] = [];
      let text = '';
      for (const it of await navigator.clipboard.read()) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) files.push(new File([await it.getType(t)], shotName(), { type: t }));
        else if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
      }
      if (files.length) { await sendImages(files); return; }
      if (!text.trim()) { sendOk = false; sendTip = '剪贴板是空的。先复制一段文字（Ctrl+C）或截个图，再点这个按钮'; return; }
      showResult(await engine({ to: 'engine', type: 'send-text', text }));
    } catch {
      sendOk = false;
      sendTip = '读不到剪贴板。可以把内容粘贴到上面的输入框里，再点「发到手机」';
    }
  }

  // 快捷键（在 chrome://extensions/shortcuts 里可以改）
  let shortcut = $state('');
  void browser.commands.getAll().then((cs) => (shortcut = cs.find((c) => c.name === 'send-clipboard')?.shortcut ?? ''));

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    void sendImages(Array.from(e.dataTransfer?.files ?? []));
  }

  function onPick() {
    if (!fileInput) return;
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void sendImages(files);
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

<svelte:document onpaste={onPaste} />

<main>
  <header>
    <h1>互传</h1>
    <div class="status {status.cls}" data-link={s?.link ?? ''}><span class="dot"></span>{status.text}</div>
    {#if s?.link === 'connected' && s.route}<div class="small">{s.route}，{s.connectMs} 毫秒连上</div>{/if}
    {#if s?.link === 'blocked'}<div class="small">有些公司或公共场所的 Wi-Fi 会这样。手机和电脑换成同一个家里的 Wi-Fi 就能用；这边会一直自动重试。</div>{/if}
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

    <section class="send" class:dragging aria-label="发到手机"
      ondragover={(e) => { e.preventDefault(); dragging = true; }} ondragleave={() => (dragging = false)} ondrop={onDrop}>
      <h2>发到手机</h2>
      <label class="auto" class:on={s.autoSend}>
        <input type="checkbox" checked={s.autoSend} onchange={(e) => setAuto((e.target as HTMLInputElement).checked)} />
        <span><b>复制就发</b>：在任何软件里 Ctrl+C 复制的字，自动发到手机（手机上互传网页开着时）</span>
      </label>
      <textarea rows="3" bind:value={out} bind:this={box} onkeydown={onKey} placeholder="输入或粘贴文字、代码、网址，按 Ctrl+Enter 发送"></textarea>
      <div class="row">
        <button class="primary" onclick={send}>发到手机</button>
        <button onclick={sendClipboard}>发刚复制的</button>
        <button onclick={() => fileInput?.click()}>选图片…</button>
      </div>
      <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={onPick} />
      {#if sendTip}<div class="result" class:ok={sendOk}>{sendTip}</div>{/if}
      <p class="hint">
        在任何软件里复制了文字或截了图，点「发刚复制的」就行{#if shortcut}；更快：复制完直接按 <b>{shortcut}</b>，不用打开这里{/if}。
        网页上选中文字、或在链接和图片上右键，也能「发到手机」。
      </p>
    </section>

    {#if needImagePermission || permTip}
      <section class="tip perm">
        {#if needImagePermission}
          <b>先允许一次</b>：要把照片直接拖进网页、或在网页的图片上右键发到手机，需要你点下面的「允许」，Chrome 会再问一次，选「允许」。
          <div><button class="primary" onclick={allowImages}>允许</button></div>
        {:else}
          {permTip} <button class="link" onclick={() => (permTip = '')}>知道了</button>
        {/if}
      </section>
    {/if}

    {#if s.everPaired && notPinned}
      <section class="tip">
        <b>把互传固定到右上角</b>：点 Chrome 右上角的拼图图标，再点「互传」旁边的图钉。这样手机发来东西时，图标上会出现数字提醒你。
        <button class="link" onclick={() => { localStorage.setItem('pinTipClosed', '1'); notPinned = false; }}>知道了</button>
      </section>
    {/if}

    <section>
      <h2>最近</h2>
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
              <ImageItem item={it} onShow={showFile} onNeedPermission={needPermission} />
            {/if}
          </div>
        {/each}
      </div>
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
  .auto { display: flex; gap: 8px; align-items: flex-start; background: var(--card); border-radius: 10px; padding: 8px 10px; margin: 0 0 8px; font-size: 13px; cursor: pointer; }
  .auto.on { background: #dcfce7; color: #166534; }
  .auto input { margin-top: 2px; width: 16px; height: 16px; flex: none; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 6px; }
  .result { padding: 8px 10px; border-radius: 8px; font-size: 13.5px; margin: 4px 0 8px; background: #fef3c7; color: #78350f; }
  .result.ok { background: #dcfce7; color: #166534; }
  .send.dragging { outline: 2px dashed #2563eb; outline-offset: 2px; border-radius: 8px; }
  .perm div { margin-top: 8px; }
  .tip { background: #fef3c7; color: #78350f; border-radius: 10px; padding: 10px 12px; font-size: 13px; border: none; margin: 8px 0; }
  footer { border-top: 1px solid var(--line); padding-top: 10px; color: var(--muted); font-size: 12px; }
  pre { white-space: pre-wrap; font-size: 11.5px; max-height: 260px; overflow: auto; }
</style>
