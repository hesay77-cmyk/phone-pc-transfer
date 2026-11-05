#!/bin/sh
# 把电脑插件打成官网上下载的安装包：apps/site/downloads/Tapaste.zip（解压出来就是一个 Tapaste 文件夹）
# 用法：在仓库根目录 sh scripts/pack-extension.sh [插件代码所在的仓库目录，默认当前]
set -e
SRC=${1:-.}
OUT=$(pwd)/apps/site/downloads
(cd "$SRC/apps/extension" && npm run build >/dev/null)
VER=$(node -p "require('$SRC/apps/extension/dist/chrome-mv3/manifest.json').version")
mkdir -p "$OUT"
rm -f "$OUT/Tapaste.zip"
(cd "$SRC/apps/extension/dist/chrome-mv3" && zip -qr -X "$OUT/Tapaste.zip" .)
printf '%s\n' "$VER" > "$OUT/version.txt"
echo "Tapaste.zip $VER $(du -k "$OUT/Tapaste.zip" | cut -f1)KB"
