// Virtual clock: every timer, rAF, performance.now/Date.now and CSS/WAAPI animation
// follows window.__adv(ms), so frames are captured at exact, smooth intervals.
(() => {
  let vt = 0;
  const BASE = 1793000000000;
  const RealDate = Date;
  performance.now = () => vt;
  Date.now = () => BASE + vt;
  window.Date = class extends RealDate {
    constructor(...a) { if (a.length) super(...a); else super(BASE + vt); }
    static now() { return BASE + vt; }
  };
  let nextId = 1;
  let raf = [];
  window.requestAnimationFrame = (cb) => { const id = nextId++; raf.push({ id, cb }); return id; };
  window.cancelAnimationFrame = (id) => { raf = raf.filter((r) => r.id !== id); };
  const timers = new Map();
  window.setTimeout = (cb, ms = 0, ...args) => { const id = nextId++; timers.set(id, { at: vt + Math.max(0, +ms || 0), cb, args, every: 0 }); return id; };
  window.setInterval = (cb, ms = 0, ...args) => { const id = nextId++; const every = Math.max(1, +ms || 1); timers.set(id, { at: vt + every, cb, args, every }); return id; };
  window.clearTimeout = window.clearInterval = (id) => { timers.delete(id); };
  const syncAnims = () => {
    for (const a of document.getAnimations()) {
      if (a.__v === undefined) { a.__v = vt - (a.currentTime || 0); a.pause(); }
      try { a.currentTime = vt - a.__v; } catch (e) {}
    }
  };
  window.__adv = (ms) => {
    const target = vt + ms;
    for (let guard = 0; guard < 10000; guard++) {
      let best = null, bid = 0;
      for (const [id, t] of timers) if (t.at <= target && (!best || t.at < best.at)) { best = t; bid = id; }
      if (!best) break;
      vt = Math.max(vt, best.at);
      if (best.every) best.at += best.every; else timers.delete(bid);
      try { typeof best.cb === 'function' ? best.cb(...best.args) : 0; } catch (e) { console.error(e); }
    }
    vt = target;
    const q = raf; raf = [];
    for (const r of q) { try { r.cb(vt); } catch (e) { console.error(e); } }
    syncAnims();
  };
  window.__vt = () => vt;
})();
