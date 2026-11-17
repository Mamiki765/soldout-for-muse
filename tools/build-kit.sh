#!/bin/sh
# SOLD OUT for Muse — 許可証キットの zip を作って、画像の箱 (ASSETS_ROOT/kit) に置く。
# フォント (しっぽり明朝 B1 ExtraBold、SIL OFL 1.1) は重いのでリポジトリに入れず、ここで取ってくる。
# 使い方 (VM で): ASSETS_ROOT=/srv/bot-assets/soldout sh tools/build-kit.sh
# This program is free software under the GNU GPL v2 or later. See LICENSE.
set -eu
cd "$(dirname "$0")/.."
ASSETS_ROOT="${ASSETS_ROOT:?ASSETS_ROOT (画像の箱のフォルダ) を指定してください}"
VERSION=0.5.0
FONT_BASE=https://raw.githubusercontent.com/google/fonts/main/ofl/shipporiminchob1
OUT="$ASSETS_ROOT/kit"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

mkdir -p "$WORK/soldout-kit/fonts" "$WORK/soldout-kit/frames" "$OUT/frames"
curl -fsSL -o "$WORK/soldout-kit/fonts/ShipporiMinchoB1-ExtraBold.ttf" "$FONT_BASE/ShipporiMinchoB1-ExtraBold.ttf"
curl -fsSL -o "$WORK/soldout-kit/fonts/OFL-ShipporiMinchoB1.txt" "$FONT_BASE/OFL.txt"
cp kit/README.md kit/make_license.py kit/license.js "$WORK/soldout-kit/"
cp kit/frames/* "$WORK/soldout-kit/frames/"
(cd "$WORK" && zip -qr "soldout-kit-$VERSION.zip" soldout-kit)

# 配る場所: zip と、ばらの枠・スクリプト・フォント (スペースのブラウザから直接読めるように)
cp "$WORK/soldout-kit-$VERSION.zip" "$OUT/"
cp kit/frames/* "$OUT/frames/"
cp kit/README.md kit/make_license.py kit/license.js "$WORK/soldout-kit/fonts/"* "$OUT/"
ls -la "$OUT" "$OUT/frames"
