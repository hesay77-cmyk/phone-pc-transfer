// 整个产品唯一的「设置」：服务器地址、手机网页网址都只在这里改。
// 构建时可以用环境变量覆盖（自动测试就是这样指到本机的）。

const env: Record<string, string | undefined> =
  (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};

const list = (v: string | undefined, fallback: string[]) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;

function stunServers(v: string | undefined): RTCIceServer[] {
  if (v === 'none') return [];
  const urls = list(v, ['stun:stun.miwifi.com:3478', 'stun:stun.cloudflare.com:3478', 'stun:stun.l.google.com:19302']);
  return urls.length ? [{ urls }] : [];
}

export const CONFIG = {
  /** 手机网页的网址，二维码里放的就是它（加上 #k=暗号） */
  phoneUrl: env.VITE_PHONE_URL || 'https://hesay77-cmyk.github.io/phone-pc-transfer/app/',
  /** 「介绍人」：只帮两台设备交换连接信息，内容不经过它 */
  signal: {
    /** 现阶段借用公共 MQTT（mqtt）；以后换成自己的服务器（ws，地址形如 wss://域名/signal），只改这里 */
    kind: (env.VITE_SIGNAL_KIND === 'ws' ? 'ws' : 'mqtt') as 'mqtt' | 'ws',
    urls: list(env.VITE_SIGNAL_URLS, ['wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.emqx.io:8084/mqtt']),
    topicPrefix: env.VITE_SIGNAL_PREFIX || 'hutong/v1/'
  },
  /**
   * 公共 STUN（只告诉设备「你在外网看起来是哪个地址」，内容不经过它，不花钱）。
   * 有了它，访客网络、2.4G/5G 分开、路由器拦了本机名字这些家里网络也有机会连上；
   * 副作用：手机用流量、电脑在家时，有些网络也能直接连上（2026-11-05 曦定：加上）。
   * 第一个在国内，第二、三个在国外（谷歌的国内连不上，不影响别的）。VITE_STUN_URLS=none 关掉。
   */
  iceServers: stunServers(env.VITE_STUN_URLS),
  /** 图片/文件分块大小 */
  chunkSize: 16 * 1024,
  /** 一次能发的文件最大多大（收的一方要把整个文件放在内存里，手机上太大会卡死） */
  maxFileBytes: 100 * 1024 * 1024
};
