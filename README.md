# 手机电脑互传

手机和电脑在同一个 Wi-Fi 下直接互传文字和图片。电脑端是 Chrome / Edge 插件，手机端是网页，不用装 App。

结构方案见 Claude Doc《手机电脑互传插件：结构方案》。

## 目录

- `step0/` 第 0 步技术验证（不是正式产品）
  - `step0/extension/` 测试用 Chrome 插件（Manifest V3）
  - `step0/phone/` 测试用手机网页，挂在 GitHub Pages 上

第 0 步借用公共 MQTT 服务（EMQX）交换连接信息，只传连接信息，不传内容。正式版会换成自己的「介绍人」服务器。
