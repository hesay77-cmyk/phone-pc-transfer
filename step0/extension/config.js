// 第 0 步测试用的配置。正式版会换成我们自己的「介绍人」服务器。
const CONFIG = {
  // 手机测试网页的网址（GitHub Pages）
  PHONE_URL: 'https://hesay77-cmyk.github.io/phone-pc-transfer/step0/phone/',
  // 测试阶段借用公共 MQTT 服务来「介绍认识」，只传连接信息，不传内容
  BROKERS: ['wss://broker-cn.emqx.io:8084/mqtt', 'wss://broker.emqx.io:8084/mqtt'],
  TOPIC_PREFIX: 'hutong-step0/v1/',
  // 同一个 Wi-Fi 下用不到 STUN；放两个国内能用的，用来对比连接方式
  ICE_SERVERS: [{ urls: ['stun:stun.miwifi.com:3478', 'stun:stun.qq.com:3478'] }],
  CHUNK: 16 * 1024
};
