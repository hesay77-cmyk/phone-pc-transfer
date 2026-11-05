// 整个产品唯一的「设置」：服务器地址、手机网页网址都只在这里改。
// 构建时可以用环境变量覆盖（自动测试就是这样指到本机的）。

const env: Record<string, string | undefined> =
  (typeof import.meta !== 'undefined' && (import.meta as any).env) || {};

const list = (v: string | undefined, fallback: string[]) =>
  v ? v.split(',').map((s) => s.trim()).filter(Boolean) : fallback;

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
  /** 同一个 Wi-Fi 直连不需要 STUN；以后做跨网络再加 */
  iceServers: [] as RTCIceServer[],
  /** 图片/文件分块大小 */
  chunkSize: 16 * 1024,
  /** 一次能发的文件最大多大（整个文件要放在内存里，手机上太大会卡死） */
  maxFileBytes: 200 * 1024 * 1024
};
