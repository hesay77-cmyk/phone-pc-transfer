<script lang="ts">
  import { localDeviceName } from '@hutong/core';
  import { flip } from 'svelte/animate';
  import { fade, slide } from 'svelte/transition';
  import { browser } from 'wxt/browser';
  import { putFile } from '../../lib/files';
  import { servePageDrop } from '../../lib/pagedrop';
  import { lang, t } from '../../lib/i18n';
  import type { EngineState, Item, SendResult, ToBg, ToEngine, ToPanel } from '../../lib/types';
  import FileItem from './FileItem.svelte';
  import ImageItem from './ImageItem.svelte';
  import Qr from './Qr.svelte';

  document.documentElement.lang = lang === 'zh' ? 'zh-CN' : 'en';
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

  servePageDrop();
  const engine = (m: ToEngine) => browser.runtime.sendMessage(m);
  const bg = (m: ToBg) => browser.runtime.sendMessage(m);

  browser.runtime.onMessage.addListener((m: ToPanel) => {
    if (m?.to === 'panel' && m.type === 'state') { s = m.state; followNewest(); markSeen(); }
  });

  // 「最近」分两栏：手机发来的 / 发到手机的。来了新的（或刚发出去）就自动切到那一栏
  let tab = $state<'phone' | 'pc'>(localStorage.getItem('tab') === 'pc' ? 'pc' : 'phone');
  let newestId: string | undefined;
  function showTab(t: 'phone' | 'pc') { tab = t; localStorage.setItem('tab', t); }
  function followNewest() {
    const top = s?.items[0];
    if (newestId !== undefined && top && top.id !== newestId) showTab(top.from);
    newestId = top?.id ?? '';
  }
  const fromPhone = $derived(s?.items.filter((it) => it.from === 'phone') ?? []);
  const toPhone = $derived(s?.items.filter((it) => it.from === 'pc') ?? []);
  const shown = $derived(tab === 'phone' ? fromPhone : toPhone);

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
      permTip = t.permDone;
    }
  }
  let permTip = $state('');

  async function load() {
    await bg({ to: 'bg', type: 'ensure-engine' }).catch(() => {});
    for (let i = 0; i < 15; i++) {
      const st = await engine({ to: 'engine', type: 'get-state' }).catch(() => null);
      if (st) { s = st; followNewest(); markSeen(); return; }
      await new Promise((r) => setTimeout(r, 300));
    }
    failed = true;
  }
  void load();

  const status = $derived.by(() => {
    if (!s) return { cls: 'wait', text: t.starting };
    if (s.link === 'connected') return { cls: 'ok', text: t.connected(localDeviceName(s.phoneName, lang)) };
    if (s.link === 'connecting') return { cls: 'wait', text: t.phoneConnecting };
    if (s.link === 'blocked') return { cls: 'bad', text: t.blocked };
    if (s.signal !== 'online') return { cls: 'wait', text: t.netConnecting };
    return { cls: 'idle', text: s.everPaired ? t.waitPhone : t.notPaired };
  });

  function showResult(r: SendResult | undefined, what = '') {
    sendOk = !!r?.ok;
    sendTip = !r?.ok ? (r?.error ?? t.notSent) : r.connected ? t.sentOk(what) : t.queued(what);
  }

  async function send() {
    const text = out;
    if (!text.trim()) return;
    const r: SendResult = await engine({ to: 'engine', type: 'send-text', text });
    out = '';
    showResult(r);
  }

  /** 发图片或文件：选的、粘贴的、拖进来的都走这里（先放进小数据库，再让引擎发） */
  async function sendFiles(files: File[]) {
    if (!files.length) return;
    for (const f of files) {
      const fileId = 'up:' + Math.random().toString(36).slice(2);
      await putFile(fileId, f);
      const r: SendResult = await engine({ to: 'engine', type: 'send-file', fileId, name: f.name || shotName() });
      showResult(r, files.length > 1 ? '' : (r.what ?? ''));
    }
  }

  const shotName = () => t.shotName(new Date().toLocaleTimeString().replace(/:/g, '-'));

  /** 侧边栏里任何地方按 Ctrl+V：剪贴板里是图片（比如刚截的图）或文件（在文件夹里复制的）就直接发到手机 */
  function onPaste(e: ClipboardEvent) {
    // 往输入框里粘文字时（剪贴板里同时有字和图，比如从 Word 复制的）照常粘文字
    if (e.target instanceof HTMLTextAreaElement && e.clipboardData?.types.includes('text/plain')) return;
    const files = Array.from(e.clipboardData?.items ?? [])
      .filter((i) => i.kind === 'file')
      .map((i) => i.getAsFile())
      .filter((f): f is File => !!f);
    if (files.length) { e.preventDefault(); void sendFiles(files); }
  }

  /** 按钮：把刚复制的内容（文字或截图）发到手机。先让引擎读；读不到再用侧边栏自己读 */
  async function sendClipboard() {
    const r: SendResult = await engine({ to: 'engine', type: 'send-clipboard' }).catch(() => ({ ok: false, code: 'no-clipboard' }));
    if (r.ok || r.code !== 'no-clipboard') { showResult(r, r.what ?? ''); return; }
    try {
      const files: File[] = [];
      let text = '';
      for (const it of await navigator.clipboard.read()) {
        const t = it.types.find((x) => x.startsWith('image/'));
        if (t) files.push(new File([await it.getType(t)], shotName(), { type: t }));
        else if (it.types.includes('text/plain')) text = await (await it.getType('text/plain')).text();
      }
      if (files.length) { await sendFiles(files); return; }
      if (!text.trim()) { sendOk = false; sendTip = t.clipEmptyBtn; return; }
      showResult(await engine({ to: 'engine', type: 'send-text', text }));
    } catch {
      sendOk = false;
      sendTip = t.clipUnreadableBtn;
    }
  }

  async function cancel(it: Item) { s = await engine({ to: 'engine', type: 'cancel', id: it.id }); }
  async function deleteItem(it: Item) { s = await engine({ to: 'engine', type: 'delete-item', id: it.id }); }
  async function clearItems() {
    if (!confirm(t.confirmClear)) return;
    s = await engine({ to: 'engine', type: 'clear-items' });
  }
  async function dismiss(what: 'newPhone' | 'skippedSecret') { s = await engine({ to: 'engine', type: 'dismiss', what }); }
  /** 发到手机的一条现在怎么样了：文字 + 颜色 */
  const pcStatus = (it: Item) => it.delivered ? { cls: 'ok', text: t.stDelivered }
    : it.dropped === 'cancelled' ? { cls: 'off', text: t.stCancelled }
    : it.dropped === 'expired' ? { cls: 'off', text: t.stExpired }
    : it.dropped === 'failed' ? { cls: 'bad', text: t.stFailed }
    : it.pct !== undefined ? { cls: 'wait', text: t.stSending(it.pct) }
    : { cls: 'wait', text: t.stWaiting };

  function onDrop(e: DragEvent) {
    e.preventDefault();
    dragging = false;
    void sendFiles(Array.from(e.dataTransfer?.files ?? []));
  }

  function onPick() {
    if (!fileInput) return;
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    void sendFiles(files);
  }

  async function reset() {
    if (!confirm(t.confirmReset)) return;
    s = await engine({ to: 'engine', type: 'reset-pairing' });
    showQr = true;
  }

  async function copyText(it: Item, e: MouseEvent) {
    await navigator.clipboard.writeText(it.text ?? '');
    (e.target as HTMLButtonElement).textContent = t.copied;
  }

  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const kb = (n?: number) => (!n ? '' : n >= 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  const showFile = (downloadId: number) => void bg({ to: 'bg', type: 'show-file', downloadId });
</script>

<svelte:document onpaste={onPaste} />

{#snippet icon(name: 'send' | 'clip' | 'image' | 'phone' | 'pc' | 'qr' | 'info' | 'trash')}
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
    {#if name === 'send'}<path d="M4 12 20 4l-6 16-3-7-7-1Z" />
    {:else if name === 'clip'}<rect x="7" y="4" width="10" height="4" rx="1.5" /><path d="M7 6H6a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-1" />
    {:else if name === 'image'}<rect x="3.5" y="4.5" width="17" height="15" rx="3" /><circle cx="9" cy="10" r="1.6" /><path d="m4 17 5-4.5 4 3.5 2.5-2 4.5 3.5" />
    {:else if name === 'phone'}<rect x="7" y="2.5" width="10" height="19" rx="2.5" /><path d="M11 18.5h2" />
    {:else if name === 'pc'}<rect x="3" y="4" width="18" height="12" rx="2" /><path d="M8 20h8M12 16v4" />
    {:else if name === 'trash'}<path d="M4.5 7h15M9.5 7V5.2c0-.7.5-1.2 1.2-1.2h2.6c.7 0 1.2.5 1.2 1.2V7M6.5 7l.8 11.6c.1 1 .9 1.9 2 1.9h5.4c1 0 1.9-.8 2-1.9L17.5 7M10.2 11v5.5M13.8 11v5.5" />
    {:else if name === 'qr'}<rect x="4" y="4" width="6" height="6" rx="1" /><rect x="14" y="4" width="6" height="6" rx="1" /><rect x="4" y="14" width="6" height="6" rx="1" /><path d="M14 14h2v2h-2zM18 18h2v2h-2zM14 18h2M18 14h2" />
    {:else}<circle cx="12" cy="12" r="8.5" /><path d="M12 11v5M12 8h.01" />{/if}
  </svg>
{/snippet}

<main>
  <header>
    <div class="brand">
      <svg class="logo" viewBox="0 0 32 32" aria-hidden="true">
        <defs><clipPath id="lc"><rect x="15" y="6" width="11" height="19" rx="3" /></clipPath></defs>
        <rect width="32" height="32" rx="9" fill="#fff" />
        <rect x="4.5" y="9" width="17" height="12" rx="3" fill="#a78bfa" />
        <rect x="15" y="6" width="11" height="19" rx="3" fill="#818cf8" />
        <rect x="4.5" y="9" width="17" height="12" rx="3" fill="#4f46e5" clip-path="url(#lc)" />
      </svg>
      <h1>Tapaste</h1>
    </div>
    <div class="status {status.cls}" data-link={s?.link ?? ''}><span class="dot"></span><span>{status.text}</span></div>
    {#if s?.link === 'blocked'}<p class="small">{t.blockedHint}</p>{/if}
    {#if s?.newerPeer}<p class="small bad">{t.newerPeer}</p>{/if}
  </header>

  {#if failed}
    <p class="tip bad">{t.engineFailed}</p>
  {:else if s}
    {#if !s.everPaired || showQr}
      <section class="card pair">
        <h2>{@render icon('qr')}{s.everPaired ? t.pairAnother : t.pairFirst}</h2>
        <p class="hint">{t.pairHint}{#if s.everPaired}{lang === 'zh' ? '' : ' '}{t.pairOnlyOne}{/if}</p>
        <div class="qrbox"><Qr text={s.pairingUrl} /></div>
        <p class="small center">
          {#if s.everPaired}<button class="link" onclick={() => (showQr = false)}>{t.hide}</button> · {/if}
          <button class="link" onclick={reset}>{t.newCode}</button>
        </p>
      </section>
    {/if}

    {#if s.receiving}
      {@const r = s.receiving}
      {@const pct = r.done || !r.size ? 100 : Math.floor((r.got / r.size) * 100)}
      {@const lost = !r.done && s.link !== 'connected'}
      <!-- 正在收手机发来的大文件：让人知道在传、传到哪了 -->
      <section class="card recv" class:lost aria-live="polite" transition:slide={{ duration: 220 }}>
        <div class="recv-top">
          <b>{r.done ? t.recvDone : lost ? t.recvLost : t.recvFromPhone}</b>
          <span class="pct">{pct}%</span>
        </div>
        <div class="recv-name" title={r.name}>{r.name}</div>
        <div class="prog"><i style="width: {pct}%"></i></div>
        <div class="small">{kb(r.got) || '0 KB'} / {kb(r.size)}</div>
      </section>
    {/if}

    <section class="card send" class:dragging aria-label={t.sendArea}
      ondragover={(e) => { e.preventDefault(); dragging = true; }} ondragleave={() => (dragging = false)} ondrop={onDrop}>
      <label class="auto" class:on={s.autoSend}>
        <span class="auto-text"><b>{t.autoTitle}</b><span>{t.autoDesc}</span></span>
        <input type="checkbox" role="switch" checked={s.autoSend} onchange={(e) => setAuto((e.target as HTMLInputElement).checked)} />
      </label>
      <textarea rows="3" bind:value={out} bind:this={box} onkeydown={onKey} placeholder={t.placeholder}></textarea>
      <div class="row">
        <button class="primary" onclick={send}>{@render icon('send')}{t.sendBtn}</button>
        <button onclick={sendClipboard}>{@render icon('clip')}{t.clipBtn}</button>
        <button onclick={() => fileInput?.click()}>{@render icon('image')}{t.pickBtn}</button>
      </div>
      <input bind:this={fileInput} type="file" multiple hidden onchange={onPick} />
      {#if sendTip}<div class="result" class:ok={sendOk}>{sendTip}</div>{/if}
      <p class="hint">{t.sendHint}</p>
    </section>

    {#if needImagePermission || permTip}
      <section class="tip perm">
        {#if needImagePermission}
          <b>{t.permTitle}</b>{t.permBody}
          <div><button class="primary" onclick={allowImages}>{t.allow}</button></div>
        {:else}
          {permTip} <button class="link" onclick={() => (permTip = '')}>{t.gotIt}</button>
        {/if}
      </section>
    {/if}

    {#if s.newPhone}
      <section class="tip">
        <b>{t.newPhoneTitle(localDeviceName(s.newPhone, lang) || (lang === 'zh' ? '手机' : 'phone'))}</b>{t.newPhoneBefore}<button class="link" onclick={reset}>{t.newCode}</button>{t.newPhoneAfter}
        <button class="link" onclick={() => dismiss('newPhone')}>{t.itsMine}</button>
      </section>
    {/if}
    {#if s.skippedSecretAt && s.autoSend}
      <section class="tip">
        {t.secretBefore}<b>{t.secretBold}</b>{t.secretAfter}
        <button class="link" onclick={() => dismiss('skippedSecret')}>{t.gotIt}</button>
      </section>
    {/if}

    {#if s.everPaired && notPinned}
      <section class="tip">
        <b>{t.pinTitle}</b>{t.pinBody}
        <button class="link" onclick={() => { localStorage.setItem('pinTipClosed', '1'); notPinned = false; }}>{t.gotIt}</button>
      </section>
    {/if}

    <section class="recent">
      <div class="tabs" role="tablist" aria-label={t.recent}>
        <button role="tab" class="t-phone" class:on={tab === 'phone'} aria-selected={tab === 'phone'} onclick={() => showTab('phone')}>
          {@render icon('phone')}{t.tabFromPhone}<span class="n">{fromPhone.length}</span>
        </button>
        <button role="tab" class="t-pc" class:on={tab === 'pc'} aria-selected={tab === 'pc'} onclick={() => showTab('pc')}>
          {@render icon('pc')}{t.tabToPhone}<span class="n">{toPhone.length}</span>
        </button>
      </div>
      {#if shown.length === 0}
        <p class="empty">
          {tab === 'phone' ? t.emptyFromPhone : t.emptyToPhone}
        </p>
      {/if}
      <!-- 换栏时整块换掉（不播淡出），只有点垃圾桶删的那一条才淡出 -->
      {#key tab}
      <div class="items">
        {#each shown as it (it.id)}
          {@const st = it.from === 'pc' ? pcStatus(it) : null}
          <div class="item" data-kind={it.kind} data-from={it.from} animate:flip={{ duration: 250 }} out:fade={{ duration: 150 }}>
            <div class="meta">
              {#if st}<span class="who">{t.whoToPhone}</span><span class="st {st.cls}">{st.text}</span>
              {:else}<span class="who">{t.whoFromPhone}</span>{#if it.kind === 'text' && it.copied}<span class="st ok">{t.copied}</span>{/if}{/if}
              <span class="when">{time(it.time) + (it.kind !== 'text' ? ' · ' + kb(it.size) : '')}</span>
              <button class="del" onclick={() => deleteItem(it)} aria-label={t.deleteOne} title={t.deleteOne}>{@render icon('trash')}</button>
            </div>
            {#if it.kind === 'text'}
              <div class="text">{it.text}</div>
              {#if it.cut}<div class="small">{t.cutNote}</div>{/if}
            {:else if it.kind === 'file'}
              <FileItem item={it} onShow={showFile} />
            {:else}
              <ImageItem item={it} onShow={showFile} onNeedPermission={needPermission} />
            {/if}
            {#if it.kind === 'text' || (it.from === 'pc' && !it.delivered && !it.dropped)}
              <div class="acts">
                {#if it.kind === 'text'}<button class="sm" onclick={(e) => copyText(it, e)}>{t.copy}</button>{/if}
                {#if it.from === 'pc' && !it.delivered && !it.dropped}<button class="sm cancel" onclick={() => cancel(it)}>{t.dontSend}</button>{/if}
              </div>
            {/if}
          </div>
        {/each}
      </div>
      {/key}
      {#if s.items.length}<p class="small center"><button class="link" onclick={clearItems}>{t.clearHistory}</button></p>{/if}
    </section>

    <footer>
      {#if s.everPaired && !showQr}<button class="link" onclick={() => (showQr = true)}>{t.showQr}</button> · {/if}
      <span>{t.version(s.version)}</span>
      <details><summary>{t.log}</summary><pre>{s.log.join('\n')}</pre></details>
    </footer>
  {/if}
</main>

<style>
  main { padding: 14px 14px 40px; }
  header { padding: 2px 2px 12px; }
  .brand { display: flex; align-items: center; gap: 9px; margin-bottom: 10px; }
  .logo { width: 28px; height: 28px; flex: none; filter: drop-shadow(0 2px 6px rgba(79, 70, 229, .22)); }
  h1 { font-size: 19px; font-weight: 700; letter-spacing: .5px; margin: 0; cursor: default; }
  h2 { display: flex; align-items: center; gap: 7px; font-size: 15px; font-weight: 650; margin: 0 0 10px; }
  h2 :global(.ic) { color: var(--accent); }
  .ic { width: 16px; height: 16px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }

  .status { display: inline-flex; align-items: center; gap: 8px; padding: 6px 12px; border-radius: 12px; font-size: 13px; font-weight: 550; background: var(--card); color: var(--muted); }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none; background: currentColor; }
  .status.ok { background: var(--ok-soft); color: var(--ok); }
  .status.ok .dot { box-shadow: 0 0 0 3px color-mix(in srgb, var(--ok) 25%, transparent); }
  .status.wait { background: var(--wait-soft); color: var(--wait); }
  .status.wait .dot { animation: pulse 1.2s ease-in-out infinite; }
  .status.bad { background: var(--bad-soft); color: var(--bad); }
  @keyframes pulse { 50% { opacity: .3; } }
  .bad { color: var(--bad); }

  .card { background: var(--surface); border-radius: 16px; padding: 14px; margin: 0 0 12px; box-shadow: var(--shadow); }
  .recv-top { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; }
  .recv-top b { font-weight: 600; color: var(--accent); }
  .recv.lost .recv-top b { color: var(--wait); }
  .recv .pct { font-weight: 600; font-variant-numeric: tabular-nums; }
  .recv-name { margin: 2px 0 8px; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .prog { height: 6px; border-radius: 3px; background: var(--card); overflow: hidden; margin-bottom: 6px; }
  .prog i { display: block; height: 100%; border-radius: inherit; background: var(--grad); transition: width .25s ease-out; }
  .recv.lost .prog i { background: var(--wait); }
  .recv .small { color: var(--muted); font-variant-numeric: tabular-nums; margin: 0; }
  .hint, .small { color: var(--muted); font-size: 12.5px; margin: 0 0 8px; }
  .hint:last-child { margin-bottom: 0; }
  .center { text-align: center; }
  .small.center { margin: 10px 0 0; }

  .pair .qrbox { display: flex; justify-content: center; padding: 6px 0 2px; }

  .auto { display: flex; gap: 12px; align-items: center; background: var(--card); border-radius: 12px; padding: 10px 12px; margin: 0 0 10px; font-size: 12.5px; cursor: pointer; transition: background .2s; }
  .auto.on { background: var(--ok-soft); }
  .auto-text { flex: 1; display: flex; flex-direction: column; color: var(--muted); }
  .auto-text b { color: var(--fg); font-size: 13.5px; font-weight: 650; }
  .auto.on .auto-text b { color: var(--ok); }
  .auto input { appearance: none; -webkit-appearance: none; margin: 0; flex: none; position: relative; width: 38px; height: 22px; border-radius: 11px; background: color-mix(in srgb, var(--muted) 40%, transparent); cursor: pointer; transition: background .2s; }
  .auto input::before { content: ''; position: absolute; top: 2px; left: 2px; width: 18px; height: 18px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .25); transition: transform .2s; }
  .auto input:checked { background: var(--ok); }
  .auto input:checked::before { transform: translateX(16px); }

  textarea { margin-bottom: 10px; min-height: 76px; }
  .row { display: flex; gap: 6px; flex-wrap: wrap; margin-bottom: 8px; }
  .row button { display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 8px 11px; }
  .row .primary { flex: 1 1 100%; padding: 10px 12px; font-weight: 600; font-size: 14.5px; }
  .row button:not(.primary) { flex: 1 1 0; white-space: nowrap; }
  .result { padding: 8px 12px; border-radius: 10px; font-size: 13px; font-weight: 500; margin: 2px 0 10px; background: var(--wait-soft); color: var(--wait); }
  .result.ok { background: var(--ok-soft); color: var(--ok); }
  .send.dragging { outline: 2px dashed var(--accent); outline-offset: 3px; }

  .tip { background: var(--wait-soft); color: var(--fg); border-radius: 14px; padding: 11px 13px; font-size: 12.5px; margin: 0 0 12px; border: 1px solid color-mix(in srgb, var(--wait) 22%, transparent); }
  .tip b { color: var(--wait); }
  .perm div { margin-top: 10px; }

  .recent { margin-top: 18px; }
  .tabs { display: flex; gap: 4px; padding: 4px; margin-bottom: 12px; background: color-mix(in srgb, var(--card) 70%, var(--line)); border-radius: 13px; }
  .tabs button { flex: 1; display: inline-flex; align-items: center; justify-content: center; gap: 6px; padding: 7px 4px; border-radius: 10px; font-weight: 600; font-size: 13px; background: transparent; color: var(--muted); }
  .tabs button:hover { color: var(--fg); background: transparent; }
  .tabs .on { background: var(--surface); box-shadow: 0 1px 3px rgba(20, 24, 36, .12); }
  .tabs .t-phone.on { color: var(--accent); }
  .tabs .t-pc.on { color: var(--ok); }
  .tabs .n { min-width: 20px; padding: 0 6px; border-radius: 10px; font-size: 11px; line-height: 18px; background: color-mix(in srgb, var(--muted) 18%, transparent); color: inherit; }
  .tabs .t-phone.on .n { background: var(--accent-soft); }
  .tabs .t-pc.on .n { background: var(--ok-soft); }
  .empty { color: var(--muted); font-size: 12.5px; text-align: center; padding: 18px 16px; margin: 0; border: 1.5px dashed var(--line); border-radius: 14px; }

  .items { display: flex; flex-direction: column; gap: 10px; }
  .item { position: relative; background: var(--surface); border-radius: 14px; padding: 10px 12px 11px 15px; box-shadow: var(--shadow); overflow: hidden; }
  .item::before { content: ''; position: absolute; left: 0; top: 0; bottom: 0; width: 4px; }
  .item[data-from="phone"]::before { background: var(--grad); }
  .item[data-from="pc"]::before { background: var(--ok); }
  .meta { display: flex; flex-wrap: wrap; align-items: center; gap: 4px 8px; font-size: 11.5px; color: var(--muted); margin-bottom: 6px; }
  .who { font-weight: 600; color: var(--fg); }
  .st { padding: 1px 7px; border-radius: 6px; font-weight: 550; background: var(--card); }
  .st.ok { background: var(--ok-soft); color: var(--ok); }
  .st.wait { background: var(--wait-soft); color: var(--wait); }
  .st.bad { background: var(--bad-soft); color: var(--bad); }
  .when { margin-left: auto; font-variant-numeric: tabular-nums; }
  .del { display: grid; place-items: center; width: 24px; height: 24px; padding: 0; margin: -4px -6px -4px 0; border-radius: 7px; background: transparent; color: var(--muted); opacity: .55; transition: opacity .15s, color .15s, background .15s; }
  .del .ic { width: 15px; height: 15px; }
  .item:hover .del { opacity: 1; }
  .del:hover { color: var(--bad); background: var(--bad-soft); opacity: 1; }
  .text { white-space: pre-wrap; word-break: break-all; font-size: 13.5px; max-height: 220px; overflow: auto; }
  .acts { display: flex; gap: 6px; margin-top: 8px; }
  .sm { padding: 3px 12px; font-size: 12px; border-radius: 8px; }
  .cancel { color: var(--bad); }

  footer { margin-top: 18px; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 12px; text-align: center; }
  footer details { margin-top: 6px; text-align: left; }
  footer summary { cursor: pointer; text-align: center; }
  pre { white-space: pre-wrap; font-size: 11.5px; max-height: 260px; overflow: auto; background: var(--surface); border-radius: 10px; padding: 8px 10px; }
</style>
