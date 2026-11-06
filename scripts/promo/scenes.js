const END = {
  zh: { t1: '点一下，', t2: '就到另一边。', sub: '手机和电脑之间互传文字、照片、视频和文件。', meta: '电脑：Chrome 或 Edge　·　手机：自带浏览器，扫码就行' },
  en: { t1: 'Tap once.', t2: 'It’s already there.', sub: 'Send text, photos, videos and files between your phone and computer.', meta: 'Computer: Chrome or Edge　·　Phone: any browser, just scan' },
};
module.exports = {
  async probe(h) {
    await h.warm(3); await h.rec(1/30);
    for (const s of ['#story', '#look', '#features', '.end']) { await h.scrollTo(s, -40); await h.warm(3); await h.rec(1/30); }
  },
  async hero(h) {
    await h.rec(2.2);
    await h.page.evaluate(() => { const c = document.querySelector('.hero .copy'); c.style.transition = 'opacity 1.2s ease, filter 1.2s ease'; c.style.opacity = 0; c.style.filter = 'blur(8px)'; });
    await h.rec(0.4);
    await h.click('#send'); await h.rec(1.6);
    await h.click('#send'); await h.rec(1.6);
    await h.click('#send'); await h.rec(1.6);
    await h.click('#back'); await h.rec(2.1);
  },
  async story(h) {
    await h.scrollTo('#story', 0); await h.warm(3);
    await h.rec(1.0); await h.click('#story'); await h.rec(7.0);
  },
  async look(h) {
    await h.scrollTo('#look', -60); await h.warm(0.1);
    await h.glide('#showWrap', -70, 2.2); await h.rec(5.3);
  },
  async features(h) {
    await h.scrollTo('#features', 40); await h.warm(0.5);
    await h.rec(1.0); await h.glide('#features h2.big', -50, 2.0); await h.rec(4.0);
  },
  async end(h) {
    const L = END[h.lang];
    await h.scrollTo('#story', 0); await h.warm(2.5);
    await h.click('#story'); await h.warm(6.5);
    await h.page.evaluate((L) => {
      const st = document.createElement('style');
      st.textContent = `.cap-wrap .caps,.ctrl{animation:hide .8s ease forwards}
      @keyframes hide{to{opacity:0;filter:blur(10px);transform:translateY(-20px)}}
      #endc{position:fixed;inset:0;z-index:60;display:flex;align-items:center;pointer-events:none}
      #endc .in{max-width:1200px;width:100%;margin:0 auto;padding:0 24px}
      #endc .r{opacity:0;animation:rise 1.4s cubic-bezier(.16,1,.3,1) forwards}
      @keyframes rise{from{opacity:0;transform:translateY(30px);filter:blur(14px)}to{opacity:1;transform:none;filter:blur(0)}}
      #endc .brand{display:flex;align-items:center;gap:14px;font:500 26px/1 var(--display);letter-spacing:-.5px}
      #endc .brand img{width:44px;height:44px;border-radius:12px}
      #endc h1{margin:30px 0 0}
      #endc .sub{margin:22px 0 0;color:#c9cbe0;font-size:18px}
      #endc .url{margin-top:34px;display:inline-flex;padding:12px 22px;border-radius:999px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);backdrop-filter:blur(20px) saturate(170%);font:450 16px/1 var(--body);letter-spacing:.2px}
      #endc .meta{margin-top:16px;color:var(--muted);font-size:13px}`;
      document.head.appendChild(st);
      const d = document.createElement('div'); d.id = 'endc';
      d.innerHTML = `<div class="in"><div class="brand r" style="animation-delay:.5s"><img src="icon.png">Tapaste</div>
        <h1><span class="l r" style="display:block;animation-delay:.75s">${L.t1}</span><span class="l shine r" style="display:block;animation-delay:.95s">${L.t2}</span></h1>
        <p class="sub r" style="animation-delay:1.25s">${L.sub}</p>
        <div class="url r" style="animation-delay:1.55s">hidaydream.com/tapaste</div>
        <div class="meta r" style="animation-delay:1.75s">${L.meta}</div></div>`;
      document.body.appendChild(d);
    }, L);
    await h.rec(5.5);
  },
};
