<script lang="ts">
  import {
    BlobStore, localKV, persistentOutbox, randomId, secretFromHash, startSession, trimForHistory,
    type BusStatus, type DeviceInfo, type LinkState, type OutItem, type Session
  } from '@hutong/core';
  import { flip } from 'svelte/animate';
  import { cubicOut } from 'svelte/easing';
  import { fly } from 'svelte/transition';
  import PhoneImage from './PhoneImage.svelte';
  import Scanner from './Scanner.svelte';

  /** 电脑发来的一条。老版本存的没有 kind，都是文字 */
  interface Got { id: string; kind?: 'text' | 'image'; text?: string; name?: string; size?: number; time: number; cut?: boolean }
  const MAX_GOT = 20;
  const photos = new BlobStore('hutong', 'files', MAX_GOT);
  interface Sent { id: string; label: string; state: 'sending' | 'waiting' | 'done' | 'cancelled' | 'expired' | 'failed'; pct?: number }

  const kv = localKV('hutong:phone:');
  const version = __APP_VERSION__;

  // 配对暗号：扫码进来的在网址 # 后面；存到手机上，再从地址栏里抹掉
  // 已经和一台电脑配好了，又打开一个不一样的配对链接：先问一句（别人发来的链接不能悄悄把手机改连到别的电脑）
  let secret = $state<string | null>(null);
  const fromHash = secretFromHash(location.hash);
  if (fromHash) {
    const old = kv.get('secret');
    if (!old || old === fromHash || confirm('要换成新的配对吗？\n电脑上刚换了新码、或者要连另一台电脑，点「好」；不知道这个链接是哪来的，点「取消」。')) {
      kv.set('secret', fromHash);
    }
    history.replaceState(null, '', location.pathname + location.search);
  }
  secret = kv.get('secret');

  // 放到手机桌面（主屏幕）：苹果的桌面图标和浏览器各存各的，配对暗号要跟着网址走。
  // 所以看「怎么放」步骤时，把暗号临时放回网址里；手机桌面图标存下的就是带暗号的网址，从桌面打开也能直接连。
  // （所以清单里故意不写 start_url：写了的话苹果会用它，暗号就丢了；看步骤时再临时换一份带暗号的清单）
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  const inChrome = /CriOS|Chrome/.test(navigator.userAgent);
  let scanning = $state(false);
  let homeOpen = $state(false);
  let homeHidden = $state(kv.get('homeTipHidden') === '1');
  const manifestLink = document.querySelector<HTMLLinkElement>('link[rel="manifest"]');
  const manifestHref = manifestLink?.getAttribute('href') ?? '';
  function openHomeTip() {
    homeOpen = true;
    if (!secret) return;
    history.replaceState(null, '', location.pathname + location.search + '#k=' + secret);
    // 有的系统会照清单里的起始网址存图标：临时换一份带暗号的清单
    if (manifestLink) {
      const abs = (p: string) => new URL(p, location.href).href;
      const man = {
        name: 'Tapaste', short_name: 'Tapaste', display: 'standalone', background_color: '#f2f2f7', theme_color: '#f2f2f7',
        start_url: location.href, scope: abs('./'),
        icons: [{ src: abs('icon-192.png'), sizes: '192x192', type: 'image/png' }, { src: abs('icon-512.png'), sizes: '512x512', type: 'image/png' }]
      };
      manifestLink.href = 'data:application/manifest+json,' + encodeURIComponent(JSON.stringify(man));
    }
  }
  function closeHomeTip(forever: boolean) {
    homeOpen = false;
    history.replaceState(null, '', location.pathname + location.search);
    if (manifestLink) manifestLink.setAttribute('href', manifestHref);
    if (forever) { kv.set('homeTipHidden', '1'); homeHidden = true; }
  }

  let signal = $state<BusStatus>('connecting');
  let link = $state<LinkState>('idle');
  let pcName = $state('');
  let got = $state<Got[]>(loadGot());
  let sent = $state<Sent[]>([]);
  let note = $state('');
  let txt = $state('');
  let newer = $state(false);
  let session: Session | null = null;
  let fileInput = $state<HTMLInputElement>();

  function loadGot(): Got[] { try { return JSON.parse(kv.get('got') || '[]'); } catch { return []; } }
  /** 存记录：太长的文字只存开头，免得手机上的存储满了整个记录都存不上 */
  function saveGot() {
    kv.set('got', JSON.stringify(got.map((g) => {
      if (g.kind === 'image' || !g.text) return g;
      const t = trimForHistory(g.text);
      return t.cut ? { ...g, text: t.text, cut: true } : g;
    })));
  }
  function clearGot() {
    if (!confirm('清空「电脑发来的」记录？')) return;
    got = [];
    saveGot();
    void photos.prune([]);
  }
  function cancelSent(id: string) { session?.transfer.cancel(id); }

  function device(): DeviceInfo {
    let id = kv.get('deviceId');
    if (!id) { id = randomId(); kv.set('deviceId', id); }
    const ua = navigator.userAgent;
    const name = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? '安卓手机' : '手机';
    return { id, role: 'phone', name, app: version };
  }

  const label = (it: OutItem) => (it.kind === 'text' ? `${it.text.length} 个字` : `照片 ${kb(it.meta.size)}`);
  const setSent = (id: string, p: Partial<Sent>) => { sent = sent.map((s) => (s.id === id ? { ...s, ...p } : s)); };

  async function start() {
    await connectSession();
    // 上次没发完的：列出来，连上后会自动补发
    for (const it of session?.transfer.pending ?? []) track(it);
    // 自动测试用：让测试脚本能摸到内部状态（正式构建里没有这一行的效果）
    if (import.meta.env.VITE_E2E) (window as any).__hutong = session;
  }

  async function connectSession() {
    if (!secret) return;
    session = await startSession({
      role: 'phone', secret, device: device(), kv,
      // 没送到电脑的存在手机上，网页被关掉再打开也接着送
      outbox: persistentOutbox(kv, new BlobStore('hutong-out', 'files', 50)),
      events: {
        signal: (s) => (signal = s),
        link: (s) => (link = s),
        peer: (d) => (pcName = d.name),
        newerPeer: () => (newer = true),
        received: async (it) => {
          let g: Got;
          if (it.kind === 'text') g = { id: it.id, kind: 'text', text: it.text, time: Date.now() };
          else {
            await photos.put(it.id, it.blob);
            g = { id: it.id, kind: 'image', name: it.meta.name, size: it.blob.size, time: Date.now() };
          }
          got = [g, ...got.filter((x) => x.id !== g.id)].slice(0, MAX_GOT);
          saveGot();
          void photos.prune(got.filter((x) => x.kind === 'image').map((x) => x.id));
        },
        progress: (it, r) => setSent(it.id, { state: 'sending', pct: Math.round(r * 100) }),
        delivered: (it) => { setSent(it.id, { state: 'done' }); note = ''; },
        dropped: (it, why) => setSent(it.id, { state: why }),
        queue: (n) => {
          if (n > 0 && !session?.link.ready) note = `还没连上电脑，连上后会自动发出（${n} 个）`;
          if (n === 0) note = '';
        },
        log: (s) => console.log('[Tapaste]', s)
      }
    });
  }
  void start();

  /** 扫码拿到新的配对暗号：换成它，重新连 */
  async function adopt(newSecret: string) {
    scanning = false;
    kv.set('secret', newSecret);
    if (newSecret === secret && session) return;
    session?.close();
    session = null;
    secret = newSecret;
    link = 'idle';
    await start();
  }

  // iPhone 切到别的 App、锁屏再回来：马上确认连接，断了就重连（在后台待得越久，越直接重连）
  let hiddenAt = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) { hiddenAt = Date.now(); return; }
    session?.resume(hiddenAt ? Date.now() - hiddenAt : 0);
    hiddenAt = 0;
  });
  // 从「返回」缓存里恢复、或者网络刚恢复：都当作待了很久
  window.addEventListener('pageshow', (e) => { if (e.persisted) session?.resume(60000); });
  window.addEventListener('online', () => session?.resume(60000));

  function track(it: OutItem) {
    const s: Sent = { id: it.id, label: label(it), state: session?.link.ready ? 'sending' : 'waiting' };
    sent = [s, ...sent].slice(0, 8);
  }

  async function pasteAndSend() {
    if (!session) return;
    let text = '';
    try {
      text = await navigator.clipboard.readText();
    } catch {
      note = '读不到剪贴板。可以在下面的框里长按粘贴，再点发送';
      return;
    }
    if (!text) { note = '剪贴板是空的，先去别的 App 里复制一段字'; return; }
    track(session.transfer.sendText(text));
  }

  function sendTyped() {
    if (!session || !txt.trim()) return;
    track(session.transfer.sendText(txt));
    txt = '';
  }

  async function onFiles() {
    if (!fileInput) return;
    const files = Array.from(fileInput.files ?? []);
    fileInput.value = '';
    for (const f of files) {
      let w: number | undefined, h: number | undefined;
      try { const b = await createImageBitmap(f); w = b.width; h = b.height; b.close(); } catch { /* 读不到尺寸不要紧 */ }
      if (session) track(session.transfer.sendFile(f, { name: f.name, w, h }));
    }
  }

  async function copy(t: string, e: MouseEvent) {
    try { await navigator.clipboard.writeText(t); (e.target as HTMLElement).textContent = '已复制'; }
    catch { (e.target as HTMLElement).textContent = '复制失败'; }
  }

  const status = $derived.by(() => {
    if (!secret) return { cls: 'bad', text: '还没配对' };
    if (link === 'connected') return { cls: 'ok', text: '已连上' + (pcName || '电脑') };
    if (link === 'offline') return { cls: 'bad', text: '电脑不在线' };
    if (link === 'blocked') return { cls: 'bad', text: '连不上电脑：这个网络不让直连' };
    if (signal !== 'online') return { cls: 'wait', text: '正在连接网络…' };
    return { cls: 'wait', text: '正在连接电脑…' };
  });
  let scrolled = $state(false);
  const onScroll = () => { scrolled = window.scrollY > 36; };
  const pop = { y: -14, duration: 420, easing: cubicOut };
  const isUrl = (t: string) => /^https?:\/\/\S+$/.test(t.trim());
  /** 像验证码（4~8 位，带数字）：放大显示，方便看着输 */
  const isCode = (t: string) => /^[A-Za-z0-9]{4,8}$/.test(t.trim()) && /\d/.test(t);
  const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

{#snippet icon(name: 'clip' | 'image' | 'up' | 'tray')}
  <svg class="ic" viewBox="0 0 24 24" aria-hidden="true">
    {#if name === 'clip'}<rect x="7.5" y="3.5" width="9" height="4" rx="1.6" /><path d="M7.5 5.5H6.5a2.5 2.5 0 0 0-2.5 2.5v10.5A2.5 2.5 0 0 0 6.5 21h11a2.5 2.5 0 0 0 2.5-2.5V8a2.5 2.5 0 0 0-2.5-2.5h-1" /><path d="M9 14h6M12 11v6" />
    {:else if name === 'image'}<rect x="3" y="4.5" width="18" height="15" rx="3.5" /><circle cx="8.8" cy="9.8" r="1.7" /><path d="m3.5 17 5.2-4.6 4.1 3.6 2.6-2.1 5.1 4" />
    {:else if name === 'up'}<path d="M12 18.5V6M6.5 11.5 12 6l5.5 5.5" />
    {:else}<path d="M3.5 13.5 6 5.5h12l2.5 8v4a2 2 0 0 1-2 2h-13a2 2 0 0 1-2-2v-4Z" /><path d="M3.5 13.5h5l1 2h5l1-2h5" />{/if}
  </svg>
{/snippet}

{#snippet logo(size: number)}
  <svg class="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
    <defs><clipPath id="lc{size}"><rect x="15" y="6" width="11" height="19" rx="3" /></clipPath></defs>
    <rect width="32" height="32" rx="7.5" fill="#fff" />
    <rect x="4.5" y="9" width="17" height="12" rx="3" fill="#a78bfa" />
    <rect x="15" y="6" width="11" height="19" rx="3" fill="#818cf8" />
    <rect x="4.5" y="9" width="17" height="12" rx="3" fill="#4f46e5" clip-path="url(#lc{size})" />
  </svg>
{/snippet}

<svelte:window onscroll={onScroll} />

<div class="glow" aria-hidden="true"><i class="b1"></i><i class="b2"></i><i class="b3"></i><i class="b4"></i></div>
<nav class="bar" class:scrolled aria-hidden={!scrolled}><span>Tapaste</span></nav>

<main>
  {#if !secret && !scanning}
    <!-- 第一次打开：像新手机开机那样，居中、留白、慢慢浮现 -->
    <section class="hello">
      <div class="hello-icon">{@render logo(84)}</div>
      <h1>Tapaste</h1>
      <p class="hello-sub">手机和电脑，点一下就到另一边。</p>
      {#if standalone}
        <p class="hello-text">第一次用，扫一下电脑上的二维码配对（只用扫这一次）。</p>
      {:else}
        <p class="hello-text">用 iPhone 自带的相机扫一下电脑上「Tapaste」插件里的二维码，或者点下面的按钮在这里扫。</p>
      {/if}
      <button class="pill" onclick={() => (scanning = true)}>扫码配对</button>
      <p class="foot-hint">电脑上没看到二维码？点开 Tapaste 侧边栏，在最下面点「换一台手机 / 显示二维码」。</p>
    </section>
  {:else}
    <header class="large">
      <h1>Tapaste</h1>
      <div class="status {status.cls}" data-link={link}><span class="dot"></span><span>{status.text}</span></div>
      {#if link === 'blocked'}
        <p class="sub-hint">电脑找到了，但这个 Wi-Fi 不让手机和电脑直接连（有些公司或公共场所的 Wi-Fi 会这样）。手机和电脑换成同一个家里的 Wi-Fi 就能用。这边会一直自动重试。</p>
      {/if}
      {#if link === 'offline'}
        <p class="sub-hint">电脑上的 Chrome 开着吗？手机和电脑连的是同一个 Wi-Fi 吗？会一直自动重试。</p>
      {/if}
      {#if newer}<p class="sub-hint red">电脑上的插件版本比这个网页新，请刷新一下这个网页</p>{/if}
    </header>

    {#if scanning}
      <section class="group pad rise"><Scanner onSecret={adopt} onClose={() => (scanning = false)} /></section>
    {:else}
      {#if !standalone && !homeHidden}
        <section class="group pad home-tip rise">
          {#if !homeOpen}
            <div class="tip-row">
              <div class="tip-icon">{@render logo(44)}</div>
              <p><b>把 Tapaste 放到手机桌面</b><br /><span>下次点图标就能用，不用再找网页。</span></p>
            </div>
            <div class="btns">
              <button class="chip-btn tinted" onclick={openHomeTip}>怎么放？</button>
              <button class="chip-btn plain" onclick={() => closeHomeTip(true)}>不用了</button>
            </div>
          {:else}
            <p><b>放到手机桌面</b></p>
            <ol>
              {#if inChrome}
                <li>点地址栏右边的「分享」按钮（方框带向上的箭头）。找不到就点右下角「…」，再点「分享」。</li>
              {:else}
                <li>点屏幕下方的「分享」按钮（方框带向上的箭头）。</li>
              {/if}
              <li>往下滑，点「添加到主屏幕」。</li>
              <li>右上角点「添加」。</li>
              <li>从桌面打开「Tapaste」，如果提示配对，点「扫码配对」扫一下电脑上的码（只用扫这一次）。</li>
            </ol>
            <div class="btns">
              <button class="chip-btn tinted" onclick={() => closeHomeTip(true)}>放好了</button>
              <button class="chip-btn plain" onclick={() => closeHomeTip(false)}>先收起</button>
            </div>
          {/if}
        </section>
      {/if}

      <section class="tiles rise" style="--d: 60ms">
        <button class="tile main" onclick={pasteAndSend}>
          {@render icon('clip')}<span>粘贴并发送到电脑</span>
        </button>
        <button class="tile" onclick={() => fileInput?.click()}>
          {@render icon('image')}<span>发照片到电脑</span>
        </button>
        <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={onFiles} />
      </section>

      <section class="compose rise" style="--d: 110ms">
        <textarea rows="1" bind:value={txt} placeholder="或者在这里打字"></textarea>
        <button class="send" class:ready={txt.trim()} onclick={sendTyped} aria-label="发送">{@render icon('up')}</button>
      </section>

      {#if note}<p class="note" in:fly={{ y: -6, duration: 260 }}>{note}</p>{/if}

      {#if sent.length}
        <section class="group list rise" style="--d: 150ms">
          {#each sent as s (s.id)}
            <div class="sent" data-state={s.state} animate:flip={{ duration: 320, easing: cubicOut }} in:fly={pop}>
              <span class="what">{s.label}</span>
              {#if s.state === 'done'}<span class="st ok">电脑已收到 ✓</span>
              {:else if s.state === 'cancelled'}<span class="st">已取消，不发了</span>
              {:else if s.state === 'expired'}<span class="st">放了一天也没送到，不发了</span>
              {:else if s.state === 'failed'}<span class="st bad">没发出去</span>
              {:else if s.state === 'sending'}<span class="st wait">发送中{s.pct !== undefined ? ` ${s.pct}%` : '…'}</span>
              {:else}<span class="st wait">等连上电脑后自动发</span>{/if}
              {#if s.state === 'waiting' || s.state === 'sending'}<button class="link-btn" onclick={() => cancelSent(s.id)}>不发了</button>{/if}
            </div>
          {/each}
        </section>
      {/if}

      <section class="got rise" style="--d: 190ms">
        <h2>电脑发来的{#if got.length}<span class="count">{got.length}</span>{/if}</h2>
        {#if got.length === 0}
          <div class="empty">{@render icon('tray')}<p>还没有。电脑上可以在网页里右键「发到手机」，或者在 Tapaste 侧边栏里发文字、网址、图片过来。</p></div>
        {/if}
        {#each got as g (g.id)}
          <div class="item" data-kind={g.kind ?? 'text'} animate:flip={{ duration: 320, easing: cubicOut }} in:fly={pop}>
            <div class="meta">{time(g.time)}{#if g.size} · {kb(g.size)}{/if}</div>
            {#if g.kind === 'image'}
              <PhoneImage id={g.id} name={g.name ?? ''} store={photos} />
            {:else}
              {@const t = g.text ?? ''}
              <div class="text" class:code={isCode(t)}>{isCode(t) ? t.trim() : t}</div>
              {#if g.cut}<p class="small">太长了，记录里只留了开头</p>{/if}
              <div class="btns">
                {#if isUrl(t)}<a class="chip-btn tinted" href={t.trim()} target="_blank" rel="noopener">打开网址</a>{/if}
                <button class="chip-btn tinted" onclick={(e) => copy(t.trim(), e)}>复制</button>
              </div>
            {/if}
          </div>
        {/each}
        {#if got.length}<p class="center"><button class="link-btn" onclick={clearGot}>清空记录</button></p>{/if}
      </section>
    {/if}
  {/if}

  <footer>
    {#if secret && !scanning}<button class="link-btn" onclick={() => (scanning = true)}>重新扫码配对</button> · {/if}
    Tapaste · 版本 {version}
  </footer>
</main>

<style>
  /* 顶上一层很淡的品牌色光晕 */
  .glow { position: absolute; inset: 0 0 auto 0; height: 420px; overflow: hidden; pointer-events: none; z-index: 0; opacity: var(--blob-o); }
  .glow i { position: absolute; width: 260px; height: 260px; border-radius: 50%; filter: blur(70px); animation: drift 18s ease-in-out infinite alternate; }
  .b1 { background: #9db7ff; left: -70px; top: -90px; }
  .b2 { background: #f3b4f0; right: -80px; top: -60px; animation-delay: -6s !important; }
  .b3 { background: #ffd2a8; left: 40%; top: 60px; width: 200px !important; height: 200px !important; animation-delay: -12s !important; }
  .b4 { background: #a8ecf5; left: -40px; top: 150px; width: 180px !important; height: 180px !important; animation-delay: -3s !important; }
  @keyframes drift { from { transform: translate(0, 0) scale(1); } to { transform: translate(30px, 24px) scale(1.12); } }

  /* 毛玻璃顶栏：滚过大标题才出现 */
  .bar { position: fixed; top: 0; left: 0; right: 0; z-index: 10; height: calc(44px + env(safe-area-inset-top)); padding-top: env(safe-area-inset-top);
    display: flex; align-items: center; justify-content: center; font-size: 17px; font-weight: 600; pointer-events: none;
    background: transparent; border-bottom: .5px solid transparent; transition: background .25s var(--ease), border-color .25s var(--ease), backdrop-filter .25s; }
  .bar span { opacity: 0; transform: translateY(6px); transition: opacity .25s var(--ease), transform .25s var(--ease); }
  .bar.scrolled { background: var(--bar); border-bottom-color: var(--sep); -webkit-backdrop-filter: saturate(180%) blur(20px); backdrop-filter: saturate(180%) blur(20px); }
  .bar.scrolled span { opacity: 1; transform: none; }

  main { position: relative; z-index: 1; padding: calc(44px + env(safe-area-inset-top)) 16px max(28px, env(safe-area-inset-bottom)); max-width: 560px; margin: 0 auto; }

  .ic { width: 22px; height: 22px; flex: none; fill: none; stroke: currentColor; stroke-width: 1.9; stroke-linecap: round; stroke-linejoin: round; }

  /* 大标题 */
  .large { padding: 2px 4px 16px; animation: rise .6s var(--ease) both; }
  h1 { font-size: 34px; line-height: 1.12; font-weight: 700; letter-spacing: .01em; margin: 0 0 8px; width: fit-content;
    background: linear-gradient(90deg, #0a84ff, #7a5cff 40%, #e15fd0 75%, #ff8a3d); -webkit-background-clip: text; background-clip: text; color: transparent; }
  .status { display: inline-flex; align-items: center; gap: 7px; font-size: 15px; font-weight: 500; color: var(--label2); transition: color .3s; }
  .dot { width: 8px; height: 8px; border-radius: 50%; background: var(--label3); flex: none; transition: background .3s, box-shadow .3s; }
  .status.ok { color: var(--green-text); }
  .status.ok .dot { background: var(--green); box-shadow: 0 0 0 4px var(--green-soft); }
  .status.wait { color: var(--orange-text); }
  .status.wait .dot { background: var(--orange); animation: breathe 1.4s ease-in-out infinite; }
  .status.bad { color: var(--red); }
  .status.bad .dot { background: var(--red); }
  .sub-hint { font-size: 15px; color: var(--label2); margin: 10px 0 0; }
  .red { color: var(--red); }

  /* 分组卡片 */
  .group { background: var(--card); border-radius: 20px; margin: 0 0 16px; overflow: hidden; }
  .pad { padding: 16px; }
  .rise { animation: rise .6s var(--ease) both; animation-delay: var(--d, 0ms); }

  .home-tip p { margin: 0; font-size: 16px; }
  .home-tip b { font-weight: 600; }
  .home-tip span { color: var(--label2); font-size: 15px; }
  .tip-row { display: flex; gap: 12px; align-items: center; margin-bottom: 14px; }
  .tip-icon { flex: none; border-radius: 11px; box-shadow: 0 2px 10px rgba(79, 70, 229, .18), 0 0 0 .5px var(--sep); line-height: 0; }
  .home-tip ol { margin: 10px 0 14px; padding-left: 22px; font-size: 16px; line-height: 1.6; color: var(--label); }
  .btns { display: flex; gap: 8px; flex-wrap: wrap; }

  /* 两个大方块，像「快捷指令」 */
  .tiles { display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin: 0 0 12px; }
  .tile { position: relative; display: flex; flex-direction: column; justify-content: space-between; align-items: flex-start; gap: 18px; min-height: 124px; padding: 16px; border: none; border-radius: 22px;
    background: var(--card); color: var(--label); text-align: left; font-size: 17px; font-weight: 600; line-height: 1.25; cursor: pointer;
    transition: transform .35s var(--ease), box-shadow .35s var(--ease), filter .2s; }
  .tile .ic { width: 30px; height: 30px; color: var(--tint); stroke-width: 1.7; }
  .tile.main { background: var(--grad); color: #fff; box-shadow: 0 10px 26px rgba(99, 102, 241, .35); }
  .tile.main .ic { color: #fff; }
  .tile.main::after { content: ''; position: absolute; inset: 0; border-radius: inherit; background: linear-gradient(180deg, rgba(255, 255, 255, .18), transparent 45%); pointer-events: none; }
  .tile:active { transform: scale(.96); filter: brightness(.96); }

  /* 像「信息」App 的输入框 */
  .compose { display: flex; align-items: flex-end; gap: 8px; background: var(--card); border-radius: 22px; padding: 7px 7px 7px 16px; margin: 0 0 16px; }
  .compose textarea { flex: 1; min-height: 36px; max-height: 40vh; padding: 6px 0; border: none; outline: none; background: transparent; resize: none; field-sizing: content; }
  .compose textarea::placeholder { color: var(--label3); }
  .send { flex: none; width: 36px; height: 36px; border-radius: 50%; border: none; display: grid; place-items: center; background: var(--fill); color: var(--label2); cursor: pointer;
    transition: background .25s var(--ease), color .25s var(--ease), transform .25s var(--ease); }
  .send .ic { width: 20px; height: 20px; stroke-width: 2.4; }
  .send.ready { background: var(--tint); color: #fff; }
  .send:active { transform: scale(.88); }

  .note { font-size: 15px; color: var(--orange-text); background: var(--orange-soft); border-radius: 14px; padding: 10px 14px; margin: -4px 0 16px; }

  /* 发出去的：设置 App 那种一行一行 */
  .list { padding: 0 0 0 16px; }
  .sent { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 10px; min-height: 48px; padding: 10px 16px 10px 0; font-size: 16px; }
  .sent + .sent { border-top: .5px solid var(--sep); }
  .what { font-weight: 500; margin-right: auto; }
  .st { font-size: 15px; color: var(--label2); }
  .st.ok { color: var(--green-text); }
  .st.wait { color: var(--orange-text); }
  .st.bad { color: var(--red); }

  /* 电脑发来的 */
  .got { margin-top: 10px; }
  h2 { display: flex; align-items: baseline; gap: 8px; font-size: 22px; font-weight: 700; margin: 0 4px 10px; }
  .count { font-size: 17px; font-weight: 500; color: var(--label2); }
  .empty { text-align: center; color: var(--label2); font-size: 15px; padding: 28px 24px; background: var(--card); border-radius: 20px; }
  .empty .ic { width: 34px; height: 34px; color: var(--label3); stroke-width: 1.5; margin-bottom: 6px; }
  .empty p { margin: 0; }
  .item { background: var(--card); border-radius: 20px; padding: 14px 16px 16px; margin-bottom: 12px; }
  .meta { font-size: 13px; color: var(--label2); font-variant-numeric: tabular-nums; }
  .text { white-space: pre-wrap; word-break: break-all; margin: 6px 0 12px; font-size: 17px; max-height: 50vh; overflow: auto; }
  .text.code { font-size: 42px; font-weight: 700; letter-spacing: 6px; font-variant-numeric: tabular-nums; margin: 8px 0 12px; }
  .small { font-size: 14px; color: var(--label2); margin: -4px 0 10px; }

  .chip-btn { display: inline-flex; align-items: center; height: 34px; padding: 0 16px; border: none; border-radius: 17px; font-size: 15px; font-weight: 600; text-decoration: none; cursor: pointer; transition: transform .25s var(--ease), opacity .2s; }
  .chip-btn.tinted { background: var(--tint-soft); color: var(--tint); }
  .chip-btn.plain { background: transparent; color: var(--label2); padding: 0 8px; }
  .chip-btn:active { transform: scale(.94); opacity: .8; }
  .link-btn { border: none; background: none; padding: 0; color: var(--tint); font-size: 15px; cursor: pointer; }
  .center { text-align: center; margin: 6px 0 0; }

  /* 第一次打开 */
  .hello { min-height: calc(100svh - 120px); display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding: 20px 12px 10px; }
  .hello > * { animation: rise .8s var(--ease) both; }
  .hello > :nth-child(2) { animation-delay: .08s; } .hello > :nth-child(3) { animation-delay: .16s; } .hello > :nth-child(4) { animation-delay: .24s; }
  .hello > :nth-child(5) { animation-delay: .32s; } .hello > :nth-child(6) { animation-delay: .4s; } .hello > :nth-child(7) { animation-delay: .48s; }
  .hello-icon { border-radius: 20px; line-height: 0; margin-bottom: 22px; box-shadow: 0 14px 40px rgba(79, 70, 229, .25), 0 0 0 .5px var(--sep); }
  .hello h1 { font-size: 40px; margin: 0 0 6px; }
  .hello-sub { font-size: 19px; color: var(--label2); margin: 0 0 30px; }
  .hello-text { font-size: 17px; margin: 0 0 22px; max-width: 320px; }
  .pill { width: min(100%, 320px); height: 52px; border: none; border-radius: 26px; background: var(--grad); color: #fff; font-size: 17px; font-weight: 600; box-shadow: 0 10px 26px rgba(99, 102, 241, .35); cursor: pointer; transition: transform .3s var(--ease); }
  .pill:active { transform: scale(.96); }
  .foot-hint { font-size: 14px; color: var(--label2); margin: 18px 0 0; max-width: 320px; }

  footer { color: var(--label3); font-size: 13px; text-align: center; margin-top: 22px; }
  footer .link-btn { font-size: 13px; }

  @keyframes rise { from { opacity: 0; transform: translateY(14px); } to { opacity: 1; transform: none; } }
  @keyframes breathe { 50% { opacity: .35; } }
</style>
