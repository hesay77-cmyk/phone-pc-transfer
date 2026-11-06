// 手机和电脑之间传的消息。只在两台设备之间走，服务器看不到。
// 每条消息带协议版本号 v：老版本遇到看不懂的新消息不会崩，只会提示升级。

export const PROTOCOL_VERSION = 1;
/** 收文件时认的最大大小（比能发的上限 CONFIG.maxFileBytes 宽，以后调大发送上限时旧版本也能收；只防对方乱报大小） */
export const MAX_FILE_BYTES = 1024 * 1024 * 1024;

export type Role = 'pc' | 'phone';

export interface DeviceInfo {
  id: string;
  role: Role;
  /** 给人看的名字，比如「iPhone」「Windows 电脑」 */
  name: string;
  /** 软件版本，方便排查 */
  app: string;
}

export interface FileMeta {
  name: string;
  size: number;
  mime: string;
  w?: number;
  h?: number;
  /** 其实是一段很长的文字（一条消息装不下，按文件分块送）：收到后当文字处理。老版本会当成 .txt 文件，不会出错 */
  asText?: boolean;
}

export type Msg =
  | { v: number; t: 'hello'; device: DeviceInfo }
  | { v: number; t: 'text'; id: string; createdAt: number; text: string }
  | { v: number; t: 'file-start'; id: string; createdAt: number; meta: FileMeta }
  | { v: number; t: 'file-end'; id: string }
  | { v: number; t: 'ack'; id: string }
  | { v: number; t: 'ping' }
  | { v: number; t: 'pong' }
  | { v: number; t: 'probe' };

export type MsgType = Msg['t'];
const KNOWN: ReadonlySet<string> = new Set<MsgType>(['hello', 'text', 'file-start', 'file-end', 'ack', 'ping', 'pong', 'probe']);

type DistributiveOmit<T, K extends keyof any> = T extends unknown ? Omit<T, K> : never;
export type MsgBody = DistributiveOmit<Msg, 'v'>;

export function encode(m: MsgBody): string {
  return JSON.stringify({ v: PROTOCOL_VERSION, ...m });
}

export type Decoded =
  | { ok: true; msg: Msg }
  | { ok: false; reason: 'bad-json' | 'bad-shape' | 'unknown-type'; newer: boolean };

/** 解析一条消息。看不懂的不抛错，返回原因；newer=true 说明对方版本比我新。 */
export function decode(raw: string): Decoded {
  let m: any;
  try {
    m = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'bad-json', newer: false };
  }
  if (!m || typeof m !== 'object' || typeof m.t !== 'string' || typeof m.v !== 'number') {
    return { ok: false, reason: 'bad-shape', newer: false };
  }
  const newer = m.v > PROTOCOL_VERSION;
  if (!KNOWN.has(m.t)) return { ok: false, reason: 'unknown-type', newer };
  if (!validShape(m)) return { ok: false, reason: 'bad-shape', newer };
  return { ok: true, msg: m as Msg };
}

function validShape(m: any): boolean {
  const str = (x: unknown) => typeof x === 'string' && x.length > 0;
  switch (m.t as MsgType) {
    case 'hello':
      return !!m.device && str(m.device.id) && (m.device.role === 'pc' || m.device.role === 'phone');
    case 'text':
      return str(m.id) && typeof m.text === 'string' && typeof m.createdAt === 'number';
    case 'file-start':
      return str(m.id) && !!m.meta && typeof m.meta.size === 'number' && m.meta.size >= 0 && m.meta.size <= MAX_FILE_BYTES && typeof m.meta.mime === 'string';
    case 'file-end':
    case 'ack':
      return str(m.id);
    default:
      return true;
  }
}

/** 随机编号（用于消息 id、会话 id） */
export function randomId(len = 12): string {
  const abc = 'abcdefghijkmnpqrstuvwxyz23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = '';
  for (const b of bytes) s += abc[b % abc.length];
  return s;
}
