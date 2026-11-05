<script lang="ts">
  import {
    BlobStore, localKV, randomId, secretFromHash, startSession,
    type BusStatus, type DeviceInfo, type LinkState, type OutItem, type Session
  } from '@hutong/core';
  import PhoneImage from './PhoneImage.svelte';

  /** 电脑发来的一条。老版本存的没有 kind，都是文字 */
  interface Got { id: string; kind?: 'text' | 'image'; text?: string; name?: string; size?: number; time: number }
  const MAX_GOT = 20;
  const photos = new BlobStore('hutong', 'files', MAX_GOT);
  interface Sent { id: string; label: string; state: 'sending' | 'waiting' | 'done'; pct?: number }

  const kv = localKV('hutong:phone:');
  const version = __APP_VERSION__;

  // 配对暗号：扫码进来的在网址 # 后面；存到手机上，再从地址栏里抹掉
  let secret = $state<string | null>(null);
  const fromHash = secretFromHash(location.hash);
  if (fromHash) {
    kv.set('secret', fromHash);
    history.replaceState(null, '', location.pathname + location.search);
  }
  secret = fromHash || kv.get('secret');

  // 放到手机桌面（主屏幕）：苹果的桌面图标和浏览器各存各的，配对暗号要跟着网址走。
  // 所以看「怎么放」步骤时，把暗号临时放回网址里；手机桌面图标存下的就是带暗号的网址，从桌面打开也能直接连。
  // （所以清单里故意不写 start_url：写了的话苹果会用它，暗号就丢了；看步骤时再临时换一份带暗号的清单）
  const standalone = matchMedia('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  const inChrome = /CriOS|Chrome/.test(navigator.userAgent);
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
        name: '互传', short_name: '互传', display: 'standalone', background_color: '#ffffff', theme_color: '#2563eb',
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
    if (!secret) return;
    session = await startSession({
      role: 'phone', secret, device: device(), kv,
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
          kv.set('got', JSON.stringify(got));
          void photos.prune(got.filter((x) => x.kind === 'image').map((x) => x.id));
        },
        progress: (it, r) => setSent(it.id, { state: 'sending', pct: Math.round(r * 100) }),
        delivered: (it) => { setSent(it.id, { state: 'done' }); note = ''; },
        queue: (n) => {
          if (n > 0 && !session?.link.ready) note = `还没连上电脑，连上后会自动发出（${n} 个）`;
          if (n === 0) note = '';
        },
        log: (s) => console.log('[互传]', s)
      }
    });
  }
  void start().then(() => {
    // 自动测试用：让测试脚本能摸到内部状态（正式构建里没有这一行的效果）
    if (import.meta.env.VITE_E2E) (window as any).__hutong = session;
  });

  // iPhone 切到别的 App 再回来：马上确认连接，断了就重连
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) session?.link.resume();
  });

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
    if (signal !== 'online') return { cls: 'wait', text: '正在连接网络…' };
    return { cls: 'wait', text: '正在连接电脑…' };
  });
  const isUrl = (t: string) => /^https?:\/\/\S+$/.test(t.trim());
  /** 像验证码（4~8 位，带数字）：放大显示，方便看着输 */
  const isCode = (t: string) => /^[A-Za-z0-9]{4,8}$/.test(t.trim()) && /\d/.test(t);
  const kb = (n: number) => (n > 1048576 ? (n / 1048576).toFixed(1) + ' MB' : Math.round(n / 1024) + ' KB');
  const time = (t: number) => new Date(t).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
</script>

<main>
  <header>
    <h1>互传</h1>
    <div class="status {status.cls}" data-link={link}><span class="dot"></span>{status.text}</div>
    {#if link === 'offline'}
      <p class="hint">电脑上的 Chrome 开着吗？手机和电脑连的是同一个 Wi-Fi 吗？会一直自动重试。</p>
    {/if}
    {#if newer}<p class="hint bad">电脑上的插件版本比这个网页新，请刷新一下这个网页</p>{/if}
  </header>

  {#if !secret && standalone}
    <section>
      <p class="big-hint">这个桌面图标还没配对。请在浏览器里打开互传网页（用相机扫电脑上的二维码），再按网页上「放到手机桌面」的步骤重新添加一次。</p>
    </section>
  {:else if !secret}
    <section>
      <p class="big-hint">请用 iPhone 自带的相机，扫一下电脑上「互传」插件里的二维码。</p>
    </section>
  {:else}
    {#if !standalone && !homeHidden}
      <section class="home-tip">
        {#if !homeOpen}
          <p><b>把互传放到手机桌面</b>，下次点图标就能用，不用再找网页。</p>
          <button class="btn" onclick={openHomeTip}>怎么放？</button>
          <button class="btn plain" onclick={() => closeHomeTip(true)}>不用了</button>
        {:else}
          <p><b>放到手机桌面：</b></p>
          <ol>
            {#if inChrome}
              <li>点地址栏右边的「分享」按钮（方框带向上的箭头）。找不到就点右下角「…」，再点「分享」。</li>
            {:else}
              <li>点屏幕下方的「分享」按钮（方框带向上的箭头）。</li>
            {/if}
            <li>往下滑，点「添加到主屏幕」。</li>
            <li>右上角点「添加」。</li>
          </ol>
          <p class="hint">以后从桌面上的「互传」图标打开，也会自动连上电脑。</p>
          <button class="btn" onclick={() => closeHomeTip(true)}>放好了</button>
          <button class="btn plain" onclick={() => closeHomeTip(false)}>先收起</button>
        {/if}
      </section>
    {/if}
    <section>
      <button class="big" onclick={pasteAndSend}>粘贴并发送到电脑</button>
      <button class="big alt" onclick={() => fileInput?.click()}>发照片到电脑</button>
      <input bind:this={fileInput} type="file" accept="image/*" multiple hidden onchange={onFiles} />
      {#if note}<p class="note">{note}</p>{/if}
      {#each sent as s (s.id)}
        <div class="sent" data-state={s.state}>
          {s.label} ·
          {#if s.state === 'done'}<span class="ok">电脑已收到</span>
          {:else if s.state === 'sending'}发送中{s.pct !== undefined ? ` ${s.pct}%` : '…'}
          {:else}等连上电脑后自动发{/if}
        </div>
      {/each}
      <textarea rows="2" bind:value={txt} placeholder="也可以在这里打字，再点发送"></textarea>
      <button class="btn" onclick={sendTyped}>发送</button>
    </section>

    <section>
      <h2>电脑发来的</h2>
      {#if got.length === 0}<p class="hint">还没有。电脑上可以在网页里右键「发到手机」，或者在互传侧边栏里发文字、网址、图片过来。</p>{/if}
      {#each got as g (g.id)}
        <div class="item" data-kind={g.kind ?? 'text'}>
          <div class="meta">{time(g.time)}{#if g.size} · {kb(g.size)}{/if}</div>
          {#if g.kind === 'image'}
            <PhoneImage id={g.id} name={g.name ?? ''} store={photos} />
          {:else}
            {@const t = g.text ?? ''}
            <div class="text" class:code={isCode(t)}>{isCode(t) ? t.trim() : t}</div>
            {#if isUrl(t)}<a class="btn" href={t.trim()} target="_blank" rel="noopener">打开网址</a>{/if}
            <button class="btn" onclick={(e) => copy(t.trim(), e)}>复制</button>
          {/if}
        </div>
      {/each}
    </section>
  {/if}

  <footer>互传 · 版本 {version}</footer>
</main>

<style>
  main { padding: max(14px, env(safe-area-inset-top)) 16px max(30px, env(safe-area-inset-bottom)); max-width: 560px; margin: 0 auto; }
  h1 { font-size: 22px; margin: 0 0 2px; }
  h2 { font-size: 16px; margin: 0 0 8px; }
  section { border-top: 1px solid var(--line); padding: 14px 0; }
  .status { font-size: 15px; margin-bottom: 8px; }
  .dot { display: inline-block; width: 9px; height: 9px; border-radius: 50%; margin-right: 6px; vertical-align: middle; background: var(--muted); }
  .ok { color: var(--ok); } .ok .dot { background: var(--ok); }
  .wait { color: var(--wait); } .wait .dot { background: var(--wait); }
  .bad { color: var(--bad); } .bad .dot { background: var(--bad); }
  .hint { font-size: 13.5px; color: var(--muted); margin: 0 0 8px; }
  .big-hint { font-size: 18px; line-height: 1.6; }
  .big { display: block; width: 100%; font-size: 19px; font-weight: 600; padding: 18px; margin: 0 0 12px; border: none; border-radius: 16px; background: #2563eb; color: #fff; }
  .big.alt { background: var(--card); color: var(--fg); border: 1px solid var(--line); }
  .big:active { opacity: .7; }
  .note { font-size: 14px; color: var(--wait); margin: 0 0 8px; }
  .sent { font-size: 14px; color: var(--muted); margin: 0 0 6px; }
  textarea { margin-top: 6px; }
  .btn { display: inline-block; padding: 8px 14px; border: 1px solid var(--line); background: var(--card); color: var(--fg); border-radius: 10px; margin: 6px 6px 0 0; text-decoration: none; font-size: 15px; }
  .home-tip { background: #eff6ff; border: none; border-radius: 14px; padding: 12px 14px; margin: 4px 0 6px; font-size: 15px; }
  .home-tip p { margin: 0 0 6px; }
  .home-tip ol { margin: 0 0 8px; padding-left: 22px; line-height: 1.6; }
  .btn.plain { border-color: transparent; background: transparent; color: var(--muted); }
  .item { background: var(--card); border-radius: 12px; padding: 10px 12px; margin-bottom: 10px; }
  .meta { font-size: 12px; color: var(--muted); }
  .text { white-space: pre-wrap; word-break: break-all; margin: 4px 0 4px; font-size: 17px; }
  .text.code { font-size: 40px; font-weight: 700; letter-spacing: 6px; font-variant-numeric: tabular-nums; margin: 6px 0; }
  footer { color: var(--muted); font-size: 12px; text-align: center; margin-top: 10px; }
</style>
