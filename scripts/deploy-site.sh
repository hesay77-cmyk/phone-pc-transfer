#!/bin/sh
# 把官网页 apps/site 挂到 https://hidaydream.com/tapaste/（曦的腾讯云香港服务器）。
# 在曦电脑上运行：双击「挂官网.bat」，或 cd E:/ai/phone-pc-transfer && sh scripts/deploy-site.sh
# 只动 /var/lib/tapaste/public 和 nginx 里新增的 /tapaste/ 两条 location；
# 改 nginx 前先备份，nginx -t 不通过就还原。重复运行只会更新页面文件。
set -e
cd "$(dirname "$0")/.."
KEY=../.server-access/long-memory-rp_ed25519
HOST=ubuntu@43.155.6.141
OPTS="-i $KEY -o StrictHostKeyChecking=accept-new -o BatchMode=yes"

echo "== 改动前检查 =="
for u in https://hidaydream.com/ https://hidaydream.com/xiaotidazuo/; do
  echo "$u $(curl -s -o /dev/null -w '%{http_code}' "$u")"
done

echo "== 上传页面 =="
ssh $OPTS $HOST 'rm -rf /tmp/tapaste-upload && mkdir -p /tmp/tapaste-upload'
scp $OPTS apps/site/index.html apps/site/icon.png $HOST:/tmp/tapaste-upload/

echo "== 服务器上安装 =="
ssh $OPTS $HOST 'sudo bash -s' <<'REMOTE'
set -e
mkdir -p /var/lib/tapaste/public
cp /tmp/tapaste-upload/* /var/lib/tapaste/public/
chmod -R a+rX /var/lib/tapaste
rm -rf /tmp/tapaste-upload

CONFS=$(grep -rlE 'server_name[^;]*[[:space:]]hidaydream\.com' /etc/nginx/sites-enabled /etc/nginx/conf.d 2>/dev/null || true)
[ -n "$CONFS" ] || { echo "找不到 hidaydream.com 的 nginx 配置，没改"; exit 1; }
for f in $CONFS; do
  real=$(readlink -f "$f")
  if grep -q 'location \^~ /tapaste/' "$real"; then echo "已配置过：$real"; continue; fi
  bak="$real.bak-tapaste-$(date +%Y%m%d%H%M%S)"
  cp "$real" "$bak"; echo "备份：$bak"
  awk '{print} /server_name[^;]*[[:space:]]hidaydream\.com/ {
    print "    location = /tapaste { return 301 /tapaste/; }";
    print "    location ^~ /tapaste/ { alias /var/lib/tapaste/public/; index index.html; }" }' "$bak" > "$real"
  if nginx -t; then echo "已加 /tapaste/：$real"; else cp "$bak" "$real"; echo "nginx -t 不通过，已还原"; exit 1; fi
done
systemctl reload nginx
REMOTE

echo "== 改动后检查 =="
sleep 1
for u in https://hidaydream.com/tapaste/ https://hidaydream.com/tapaste/icon.png https://hidaydream.com/ https://hidaydream.com/xiaotidazuo/; do
  echo "$u $(curl -s -o /dev/null -w '%{http_code}' "$u")"
done
curl -s https://hidaydream.com/tapaste/ | grep -q Tapaste && echo "页面内容正确" || echo "页面内容不对"
