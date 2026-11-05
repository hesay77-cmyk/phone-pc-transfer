// 配对：电脑生成一个「暗号」，放在二维码网址的 # 后面（浏览器不会把 # 后面发给服务器）。
// 两台设备用暗号做两件事：
//   1. 算出一个只有它俩知道的「频道名」，在介绍人那里碰头；
//   2. 把交换的连接信息加密并签名，介绍人看不懂也改不了，别人冒充不了。
// 连接信息里带着双方的加密指纹，所以之后的直连也就确认了是自己的设备。

const enc = new TextEncoder();
const dec = new TextDecoder();

export function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
export function fromB64url(s: string): Uint8Array {
  const b = atob(s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4));
  const out = new Uint8Array(b.length);
  for (let i = 0; i < b.length; i++) out[i] = b.charCodeAt(i);
  return out;
}

/** 新的配对暗号：32 字节随机数 */
export function newSecret(): string {
  return b64url(crypto.getRandomValues(new Uint8Array(32)));
}

export function isValidSecret(s: unknown): s is string {
  if (typeof s !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(s)) return false;
  return fromB64url(s).length === 32;
}

/** 二维码里的网址：手机网页 + #k=暗号 */
export function pairingUrl(phoneUrl: string, secret: string): string {
  return phoneUrl.replace(/#.*$/, '') + '#k=' + secret;
}

/** 从网址的 # 部分读出暗号，读不到返回 null */
export function secretFromHash(hash: string): string | null {
  const m = hash.match(/[#&]k=([A-Za-z0-9_-]{43})(?:&|$)/);
  return m && isValidSecret(m[1]) ? m[1] : null;
}

export interface PairKeys {
  /** 在介绍人那里碰头用的频道名（由暗号算出，看不出暗号） */
  topic: string;
  /** 加密 + 签名连接信息用的钥匙 */
  key: CryptoKey;
}

export async function deriveKeys(secret: string): Promise<PairKeys> {
  const raw = fromB64url(secret);
  const base = await crypto.subtle.importKey('raw', raw as BufferSource, 'HKDF', false, ['deriveKey', 'deriveBits']);
  const salt = enc.encode('hutong-pair-v1');
  const topicBits = await crypto.subtle.deriveBits(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('topic') }, base, 128);
  const key = await crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt, info: enc.encode('signal-aes-gcm') },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const topic = Array.from(new Uint8Array(topicBits), (b) => b.toString(16).padStart(2, '0')).join('');
  return { topic, key };
}

/** 加密并签名（AES-GCM：改一个字节都会解不开） */
export async function seal(key: CryptoKey, data: unknown): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, enc.encode(JSON.stringify(data))));
  const out = new Uint8Array(iv.length + ct.length);
  out.set(iv);
  out.set(ct, iv.length);
  return b64url(out);
}

/** 解密；不是用同一个暗号加密的、或被改过，返回 null */
export async function open<T = unknown>(key: CryptoKey, sealed: string): Promise<T | null> {
  try {
    const buf = fromB64url(sealed);
    if (buf.length < 13) return null;
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buf.slice(0, 12) }, key, buf.slice(12));
    return JSON.parse(dec.decode(pt)) as T;
  } catch {
    return null;
  }
}
