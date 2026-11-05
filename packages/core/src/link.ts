// 直连这一层：手机和电脑在同一个 Wi-Fi 里用 WebRTC 数据通道直接连。
// 电脑一直等着；手机网页一打开就去连。
// iPhone 网页一切到别的 App 就会被暂停、连接会断，所以：
//   - 心跳：5 秒一次，15 秒听不到对方就当断了；
//   - 手机切回网页时先问一声「还在吗」，1.5 秒没回应马上重连；
//   - 重连要快：拿到本机地址后 300 毫秒就发出连接信息，不干等。

import { decode, encode, randomId, type DeviceInfo, type Msg, type MsgBody, type Role } from './protocol';
import type { SecureSignal, SignalMsg } from './signal';

/**
 * idle：电脑在等手机来连；connecting：正在连；connected：连上了；offline：（手机）找不到电脑；
 * blocked：通过介绍人找到对方了，但直连连不上——多半是这个网络不让设备之间直接通信（有些公司/公共 Wi-Fi）。
 */
export type LinkState = 'idle' | 'connecting' | 'connected' | 'offline' | 'blocked';

export interface LinkInfo {
  /** true=局域网直连；false=经公网；null=看不出来 */
  lan: boolean | null;
  route: string;
  connectMs: number;
}

export interface LinkEvents {
  state?(s: LinkState, info?: LinkInfo): void;
  message?(m: Msg): void;
  binary?(b: ArrayBuffer): void;
  /** 每次听到对方（任何消息）都会调用，用来在切回网页确认连接后继续发 */
  heard?(): void;
  /** 对方的版本比我新、发来了我看不懂的消息 */
  newerPeer?(): void;
  log?(s: string): void;
}

export interface LinkOptions {
  role: Role;
  device: DeviceInfo;
  iceServers: RTCIceServer[];
  /** 手机端：多久没回应就当「电脑不在线」（只影响显示，会继续尝试） */
  offlineAfterMs?: number;
}

const HEARTBEAT_MS = 5000;
const DEAD_AFTER_MS = 15000;
const PROBE_WAIT_MS = 1500;
const CONNECT_GUARD_MS = 15000;
/** 双方都回应了，这么久还没直连上，就告诉用户「这个网络不让直连」（同一个 Wi-Fi 下一般 1 秒内就连上） */
const BLOCKED_AFTER_MS = 6000;
/** 电脑这么久没再听到手机来连，就不再显示「不让直连」 */
const BLOCKED_FORGET_MS = 40000;
const HELLO_EVERY_MS = 3000;

export class PeerLink {
  state: LinkState = 'idle';
  info: LinkInfo | null = null;
  peerDevice: DeviceInfo | null = null;

  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private sid = '';
  private t0 = 0;
  private lastHeard = 0;
  private resumedAt = 0;
  private helloTimer: ReturnType<typeof setInterval> | undefined;
  private helloStarted = 0;
  private guardTimer: ReturnType<typeof setTimeout> | undefined;
  private slowTimer: ReturnType<typeof setTimeout> | undefined;
  /** 已经发现这个网络不让直连：接着重试，但界面上一直显示 blocked，直到连上 */
  private blockedHint = false;
  private lastHelloAt = 0;
  private beatTimer: ReturnType<typeof setInterval> | undefined;
  private answeredSid = '';

  constructor(private signal: SecureSignal, private opts: LinkOptions, private ev: LinkEvents = {}) {
    signal.onMessage((m) => void this.onSignal(m));
    this.beatTimer = setInterval(() => this.heartbeat(), HEARTBEAT_MS);
  }

  /** 连接真的可用：通道开着，而且（切回来之后）听到过对方 */
  get ready(): boolean {
    return !!this.dc && this.dc.readyState === 'open' && this.lastHeard >= this.resumedAt;
  }

  get bufferedAmount(): number { return this.dc?.bufferedAmount ?? 0; }

  /** 开始工作。电脑：告诉手机「我在线」；手机：去连电脑。 */
  start() {
    if (this.opts.role === 'pc') void this.signal.send({ type: 'pc-online' });
    else this.connect('打开网页');
  }

  /** 手机：（重新）发起连接 */
  connect(why: string) {
    if (this.opts.role !== 'phone') return;
    this.log('去连电脑：' + why);
    this.teardown();
    this.sid = randomId(10);
    this.t0 = now();
    this.helloStarted = Date.now();
    this.setState('connecting');
    clearInterval(this.helloTimer);
    const say = () => {
      if (this.state === 'connected') return clearInterval(this.helloTimer);
      if ((this.state === 'connecting' || this.state === 'blocked') && Date.now() - this.helloStarted > (this.opts.offlineAfterMs ?? 9000)) {
        this.setState('offline');
      }
      void this.signal.send({ type: 'hello', sid: this.sid });
    };
    say();
    this.helloTimer = setInterval(say, HELLO_EVERY_MS);
  }

  /** 手机：网页回到前台时调用。hiddenMs = 在后台待了多久；待久了（比如锁屏）直连多半已经死了，不用探，直接重连 */
  resume(hiddenMs = 0) {
    this.resumedAt = Date.now();
    if (!(this.dc && this.dc.readyState === 'open')) {
      if (this.opts.role === 'phone') this.connect('切回网页，连接已断');
      return;
    }
    if (hiddenMs > LONG_HIDDEN_MS && this.opts.role === 'phone') { this.connect(`在后台待了 ${Math.round(hiddenMs / 1000)} 秒`); return; }
    this.sendRaw({ t: 'probe' });
    setTimeout(() => {
      if (this.lastHeard < this.resumedAt && this.opts.role === 'phone') this.connect('切回网页后电脑没回应');
    }, PROBE_WAIT_MS);
  }

  /** 发出去的东西对方迟迟不确认时调用。手机：重新连；电脑：断开，等手机重连。 */
  reconnect(why: string) {
    if (this.opts.role === 'phone') { this.connect(why); return; }
    this.log('断开重来：' + why);
    this.teardown();
    this.setState('idle');
  }

  send(m: MsgBody): boolean {
    return this.sendRaw(m);
  }

  sendBinary(buf: ArrayBuffer): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    try { this.dc.send(buf); return true; } catch { return false; }
  }

  /** 发送缓冲太满时等一等（发大图用） */
  waitDrain(limit = 1024 * 1024): Promise<void> {
    const ch = this.dc;
    if (!ch || ch.bufferedAmount <= limit) return Promise.resolve();
    return new Promise((res) => {
      const t = setTimeout(res, 3000);
      ch.bufferedAmountLowThreshold = 256 * 1024;
      ch.onbufferedamountlow = () => { ch.onbufferedamountlow = null; clearTimeout(t); res(); };
    });
  }

  close() {
    clearInterval(this.beatTimer);
    clearInterval(this.helloTimer);
    this.teardown();
    this.setState('idle');
  }

  // ---------------- 内部 ----------------

  private sendRaw(m: MsgBody): boolean {
    if (!this.dc || this.dc.readyState !== 'open') return false;
    try { this.dc.send(encode(m)); return true; } catch { return false; }
  }

  private log(s: string) { this.ev.log?.(s); }

  private setState(s: LinkState, info?: LinkInfo) {
    if (s === 'connected' || s === 'offline') this.blockedHint = false;
    if (this.blockedHint && (s === 'connecting' || s === 'idle')) s = 'blocked';
    if (this.state === s && !info) return;
    this.state = s;
    this.ev.state?.(s, info);
  }

  private teardown() {
    clearTimeout(this.guardTimer);
    clearTimeout(this.slowTimer);
    const pc = this.pc;
    this.pc = null;
    this.dc = null;
    if (pc) try { pc.close(); } catch { /* 已经关了 */ }
  }

  private heartbeat() {
    if (this.blockedHint && this.opts.role === 'pc' && Date.now() - this.lastHelloAt > BLOCKED_FORGET_MS) {
      this.blockedHint = false;
      if (this.state === 'blocked') this.setState('idle');
    }
    if (!this.dc || this.dc.readyState !== 'open') return;
    if (this.opts.role === 'pc') this.sendRaw({ t: 'ping' });
    if (this.state === 'connected' && Date.now() - this.lastHeard > DEAD_AFTER_MS) {
      this.log('15 秒没听到对方，当作已断开');
      this.teardown();
      if (this.opts.role === 'phone') this.connect('心跳超时');
      else this.setState('idle');
    }
  }

  private async onSignal(m: SignalMsg) {
    if (this.opts.role === 'pc') {
      if (m.type === 'hello') await this.pcOnHello(m.sid);
      else if (m.type === 'answer' && m.sid === this.sid && this.pc) {
        const pc = this.pc;
        try { await pc.setRemoteDescription({ type: 'answer', sdp: m.sdp }); this.watchSlow(pc); }
        catch (e) { this.log('设置手机的回应出错：' + (e as Error).message); }
      }
    } else {
      if (m.type === 'pc-online' && this.sid && this.answeredSid !== this.sid && this.state !== 'connected') {
        // 电脑刚上线：马上再打一次招呼，不用等下一轮
        this.setState('connecting');
        void this.signal.send({ type: 'hello', sid: this.sid });
      }
      else if (m.type === 'offer' && m.sid === this.sid) await this.phoneOnOffer(m.sid, m.sdp);
    }
  }

  /** 电脑：手机来打招呼了 */
  private async pcOnHello(sid: string) {
    this.lastHelloAt = Date.now();
    if (sid === this.sid && this.pc?.localDescription) {
      // 手机没收到上一封，重发同一个 offer，不重新开始
      void this.signal.send({ type: 'offer', sid, sdp: this.pc.localDescription.sdp });
      return;
    }
    this.log('手机来连了');
    this.teardown();
    this.sid = sid;
    this.t0 = now();
    this.setState('connecting');
    const pc = this.newPc();
    const dc = pc.createDataChannel('data', { ordered: true });
    this.bindChannel(dc, pc);
    await pc.setLocalDescription(await pc.createOffer());
    await waitIce(pc, 2500);
    if (this.pc !== pc) return;
    void this.signal.send({ type: 'offer', sid, sdp: pc.localDescription!.sdp });
    this.guard(pc);
  }

  /** 手机：电脑回应了 */
  private async phoneOnOffer(sid: string, sdp: string) {
    if (this.answeredSid === sid) return; // 同一次连接只回应一次
    this.answeredSid = sid;
    clearInterval(this.helloTimer);
    this.setState('connecting');
    const pc = this.newPc();
    pc.ondatachannel = (e) => this.bindChannel(e.channel, pc);
    try {
      await pc.setRemoteDescription({ type: 'offer', sdp });
      await pc.setLocalDescription(await pc.createAnswer());
      await waitIce(pc, 2500);
    } catch (e) {
      this.log('回应电脑出错：' + (e as Error).message);
      return;
    }
    if (this.pc !== pc) return;
    void this.signal.send({ type: 'answer', sid, sdp: pc.localDescription!.sdp });
    this.guard(pc);
    this.watchSlow(pc);
  }

  /** 双方都回应了还迟迟连不上：多半是网络不让直连，告诉用户（不打断重试） */
  private watchSlow(pc: RTCPeerConnection) {
    clearTimeout(this.slowTimer);
    this.slowTimer = setTimeout(() => {
      if (this.pc !== pc || this.state === 'connected') return;
      if (!this.blockedHint) this.log('找到对方了，但直连不上：这个网络可能不让设备之间直接通信');
      this.blockedHint = true;
      this.setState('blocked');
    }, BLOCKED_AFTER_MS);
  }

  private newPc(): RTCPeerConnection {
    this.teardown();
    const pc = new RTCPeerConnection({ iceServers: this.opts.iceServers });
    this.pc = pc;
    pc.onconnectionstatechange = () => {
      if (this.pc !== pc) return;
      const s = pc.connectionState;
      if (s === 'failed' || s === 'closed') {
        this.log('连接状态：' + s);
        this.teardown();
        if (this.opts.role === 'phone') this.connect('连接断了');
        else this.setState('idle');
      }
    };
    return pc;
  }

  /** 15 秒没连上就重来（手机）或放弃这次（电脑） */
  private guard(pc: RTCPeerConnection) {
    clearTimeout(this.guardTimer);
    this.guardTimer = setTimeout(() => {
      if (this.pc !== pc || this.state === 'connected') return;
      this.log('15 秒没连上');
      if (this.opts.role === 'phone') this.connect('15 秒没连上，重来');
      else { this.teardown(); this.setState('idle'); }
    }, CONNECT_GUARD_MS);
  }

  private bindChannel(ch: RTCDataChannel, pc: RTCPeerConnection) {
    ch.binaryType = 'arraybuffer';
    this.dc = ch;
    ch.onopen = async () => {
      if (this.pc !== pc) return;
      clearTimeout(this.guardTimer);
      clearInterval(this.helloTimer);
      this.lastHeard = Date.now();
      const connectMs = Math.round(now() - this.t0);
      const info = { ...(await describeRoute(pc)), connectMs };
      this.info = info;
      this.log('已直连：' + info.route + '，用时 ' + connectMs + ' 毫秒');
      this.sendRaw({ t: 'hello', device: this.opts.device });
      this.setState('connected', info);
    };
    ch.onclose = () => {
      if (this.dc !== ch) return;
      this.log('直连通道关了');
      this.dc = null;
      if (this.opts.role === 'phone') this.connect('通道关了');
      else this.setState('idle');
    };
    ch.onmessage = (e) => {
      if (this.dc !== ch) return;
      this.lastHeard = Date.now();
      if (typeof e.data !== 'string') { this.ev.binary?.(e.data as ArrayBuffer); return; }
      this.ev.heard?.();
      const d = decode(e.data);
      if (!d.ok) { if (d.newer) this.ev.newerPeer?.(); return; }
      const m = d.msg;
      if (m.t === 'ping') { this.sendRaw({ t: 'pong' }); return; }
      if (m.t === 'probe') { this.sendRaw({ t: 'pong' }); return; }
      if (m.t === 'pong') return;
      if (m.t === 'hello') this.peerDevice = m.device;
      this.ev.message?.(m);
    };
  }
}

/** 在后台待超过这么久，直连就不探了，直接重连（探一次要等 1.5 秒） */
const LONG_HIDDEN_MS = 15000;

const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

/** 等收集连接地址：拿到本机地址（host）后 300 毫秒就够了，最多等 maxMs */
export function waitIce(pc: RTCPeerConnection, maxMs: number): Promise<void> {
  return new Promise((res) => {
    if (pc.iceGatheringState === 'complete') return res();
    let early: ReturnType<typeof setTimeout> | undefined;
    const done = () => { clearTimeout(tm); clearTimeout(early); res(); };
    const tm = setTimeout(done, maxMs);
    pc.addEventListener('icegatheringstatechange', () => { if (pc.iceGatheringState === 'complete') done(); });
    pc.addEventListener('icecandidate', (e) => {
      if (!early && e.candidate && / typ host/.test(e.candidate.candidate)) early = setTimeout(done, 300);
    });
  });
}

export function isPrivateIp(a?: string | null): boolean {
  return !!a && (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|fe80:|fd|fc)/i.test(a) || a.endsWith('.local'));
}

async function describeRoute(pc: RTCPeerConnection): Promise<Omit<LinkInfo, 'connectMs'>> {
  try {
    const stats = await pc.getStats();
    let pair: any = null;
    stats.forEach((s: any) => { if (s.type === 'transport' && s.selectedCandidatePairId) pair = stats.get(s.selectedCandidatePairId); });
    if (!pair) stats.forEach((s: any) => { if (s.type === 'candidate-pair' && s.nominated && s.state === 'succeeded') pair = s; });
    if (!pair) return { lan: null, route: '看不到连接方式' };
    const l: any = stats.get(pair.localCandidateId) || {};
    const r: any = stats.get(pair.remoteCandidateId) || {};
    const types = `${l.candidateType ?? '?'} / ${r.candidateType ?? '?'}`;
    if (l.candidateType === 'relay' || r.candidateType === 'relay') return { lan: false, route: `经中转（${types}）` };
    const lan = l.candidateType === 'host' || isPrivateIp(l.address) || isPrivateIp(r.address);
    return { lan, route: `${lan ? '局域网直连' : '经公网直连'}（${types}）` };
  } catch (e) {
    return { lan: null, route: '读连接方式出错：' + (e as Error).message };
  }
}
